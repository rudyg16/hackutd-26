/**
 * Alert → ticket pipeline (SIM-SPEC §8). The simulator reports as `user-monitor` and only ever
 * creates `ai_draft` tickets — a human approves. LLM credits are limited, so this dedupes first
 * and throttles hard before calling `draft-ticket`.
 */
import type { IssueCategory, TicketDraft } from "@/shared/types";
import type { SimConfig } from "./config";
import type { InvDevice, SimAlert } from "./engine/types";

export const MONITOR_USER_ID = "user-monitor";

/** Everything the pipeline needs from the database. */
export interface TicketStore {
  /** Open (`ai_draft`, `open`, `in_progress`) ticket for this position + category, if any. */
  findOpenTicket(positionId: string, category: IssueCategory): Promise<{ id: string } | null>;
  /** Open tickets reported by `user-monitor`. */
  countOpenMonitorTickets(): Promise<number>;
  linkAlert(alertId: string, ticketId: string): Promise<void>;
}

/** The app's HTTP API, called as `user-monitor`. */
export interface TicketApi {
  draftTicket(reportText: string): Promise<TicketDraft>;
  createTicket(draft: TicketDraft & { status: "ai_draft" }): Promise<{ id: string }>;
  addLog(ticketId: string, entry: { body: string; internal: boolean }): Promise<void>;
}

export type PipelineOutcome =
  | { kind: "deduped"; ticketId: string }
  | { kind: "created"; ticketId: string }
  | { kind: "throttled"; reason: "gap" | "max-open" }
  | { kind: "failed"; error: string };

export class TicketPipeline {
  private lastAttemptMs = Number.NEGATIVE_INFINITY;

  constructor(
    private store: TicketStore,
    private api: TicketApi,
    private config: Pick<SimConfig, "minTicketGapSec" | "maxOpenSimTickets">,
    private now: () => number = Date.now,
    private log: (msg: string) => void = () => {},
  ) {}

  async handle(alertId: string, alert: SimAlert, device: Pick<InvDevice, "rackId">): Promise<PipelineOutcome> {
    try {
      // 2. Duplicate check: add to the open ticket instead of creating another.
      const existing = await this.store.findOpenTicket(alert.positionId, alert.category);
      if (existing) {
        await this.api.addLog(existing.id, { body: alert.message, internal: true });
        await this.store.linkAlert(alertId, existing.id);
        return { kind: "deduped", ticketId: existing.id };
      }

      // 3. Throttle. A skipped alert keeps ticket_id null; the next alert for the position retries.
      if (this.now() - this.lastAttemptMs < this.config.minTicketGapSec * 1000) {
        return { kind: "throttled", reason: "gap" };
      }
      if ((await this.store.countOpenMonitorTickets()) >= this.config.maxOpenSimTickets) {
        return { kind: "throttled", reason: "max-open" };
      }

      // 4–5. Draft with the AI, then create as ai_draft. Counted as an attempt even if it fails.
      this.lastAttemptMs = this.now();
      const draft = await this.api.draftTicket(alert.message);
      const ticket = await this.api.createTicket({
        ...draft,
        // The simulator knows exactly where and what the fault is; the AI decides wording and severity.
        rackId: device.rackId,
        deviceId: alert.deviceId,
        positionId: alert.positionId,
        category: alert.category,
        status: "ai_draft",
      });
      await this.store.linkAlert(alertId, ticket.id);
      return { kind: "created", ticketId: ticket.id };
    } catch (e) {
      // 6. Keep the alert with ticket_id null; no template fallback.
      const error = e instanceof Error ? e.message : String(e);
      this.log(`[pipeline] ${alert.positionId} ${alert.category}: ${error}`);
      return { kind: "failed", error };
    }
  }
}
