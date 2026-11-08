/**
 * Supabase + HTTP adapter for the simulator (SIM-SPEC §1, §8, §9). All I/O lives here.
 * It must not import `lib/ai/*` or `db/client.ts` (both `server-only`): it builds its own
 * Supabase client from `.env.local`, like `scripts/seed.ts`.
 *
 * Needs Person B's migration with the SIM-SPEC §9 tables:
 *   sim_part_state, position_metrics, alerts, sim_control, sim_commands.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { IssueCategory, ResolutionAction, TicketDraft } from "@/shared/types";
import type {
  InvPart,
  PartCondition,
  PositionMetrics,
  SimAlert,
  SimCommand,
  SimEvent,
  SimInventory,
} from "./engine";
import { inventoryFromSeed } from "./engine";
import { MONITOR_USER_ID, type TicketApi } from "./pipeline";
import type { ConditionChanges, ControlRow, SimStore } from "./runner";

const OPEN_STATUSES = ["ai_draft", "open", "in_progress"];
const CHUNK = 500;
const PAGE = 1000;

export function createSimDb(env: NodeJS.ProcessEnv = process.env): SupabaseClient {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  return createClient(url, key, { auth: { persistSession: false } });
}

function check<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

const chunks = <T>(rows: T[], size = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
};

type Row = Record<string, unknown>;

export class SupabaseStore implements SimStore {
  constructor(private db: SupabaseClient) {}

  /** Supabase caps a select at 1000 rows by default, so page through. */
  private async fetchAll(table: string, select: string, filter?: <T extends { is: (c: string, v: null) => T }>(q: T) => T): Promise<Row[]> {
    const out: Row[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = this.db.from(table).select(select).range(from, from + PAGE - 1);
      if (filter) q = filter(q);
      const rows = check(await q, `read ${table}`) as unknown as Row[];
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }

  async loadInventory(): Promise<SimInventory> {
    const [racks, devices, positions, parts] = await Promise.all([
      this.fetchAll("racks", "id, tenant_id"),
      this.fetchAll("devices", "id, rack_id, kind, model_id"),
      this.fetchAll("positions", "id, device_id, local_id, kind"),
      this.fetchAll("installed_parts", "id, position_id, kind, installed_at", (q) => q.is("removed_at", null)),
    ]);
    const nowMs = Date.now();
    // Real age becomes sim age: sim time 0 is "now", so existing parts have negative install times.
    return inventoryFromSeed({
      racks: racks.map((r) => ({ id: r.id as string, tenantId: r.tenant_id as string })),
      devices: devices.map((d) => ({
        id: d.id as string,
        rackId: d.rack_id as string,
        kind: d.kind as string,
        modelId: d.model_id as string,
      })),
      positions: positions.map((p) => ({
        id: p.id as string,
        deviceId: p.device_id as string,
        localId: p.local_id as string,
        kind: p.kind as string,
      })),
      installed_parts: parts.map((p) => ({
        id: p.id as string,
        positionId: p.position_id as string,
        kind: p.kind as string,
        installedDaysAgo: Math.max(0, (nowMs - Date.parse(p.installed_at as string)) / 86_400_000),
        removedDaysAgo: null,
      })),
    });
  }

  private static toCondition(r: Row): PartCondition {
    return {
      partId: (r.part_id as string | null) ?? null,
      positionId: r.position_id as string,
      defect: (r.defect as PartCondition["defect"]) ?? null,
      severity: Number(r.severity),
      onsetAt: Number(r.onset_sim_s),
      wear: Number(r.wear),
      suppressedUntil: r.suppressed_until_sim_s === null ? null : Number(r.suppressed_until_sim_s),
    };
  }

  private static fromCondition(key: string, c: PartCondition): Row {
    return {
      id: key,
      part_id: c.partId,
      position_id: c.positionId,
      defect: c.defect,
      severity: c.severity,
      onset_sim_s: c.onsetAt,
      wear: c.wear,
      suppressed_until_sim_s: c.suppressedUntil,
      updated_at: new Date().toISOString(),
    };
  }

  private static key = (c: PartCondition) => c.partId ?? `pos:${c.positionId}`;

  private static toControl(r: Row): ControlRow {
    return {
      paused: Boolean(r.paused),
      speed: Number(r.speed),
      seed: r.seed === null ? null : Number(r.seed),
      scenario: (r.scenario as string | null) ?? null,
      simTimeS: Number(r.sim_time_s),
    };
  }

  async loadRun() {
    const control = check(await this.db.from("sim_control").select("*").eq("id", 1).maybeSingle(), "read sim_control");
    if (!control) return null;
    const rows = await this.fetchAll("sim_part_state", "*");
    if (rows.length === 0) return null;
    const conditions: Record<string, PartCondition> = {};
    for (const r of rows) conditions[r.id as string] = SupabaseStore.toCondition(r);
    return { control: SupabaseStore.toControl(control as Row), conditions };
  }

  async startRun(control: ControlRow, conditions: Record<string, PartCondition>) {
    check(await this.db.from("sim_part_state").delete().neq("id", ""), "clear sim_part_state");
    check(await this.db.from("sim_commands").delete().is("consumed_at", null), "clear pending commands");
    const rows = Object.entries(conditions).map(([k, c]) => SupabaseStore.fromCondition(k, c));
    for (const part of chunks(rows)) check(await this.db.from("sim_part_state").insert(part), "insert sim_part_state");
    check(
      await this.db.from("sim_control").upsert({
        id: 1,
        paused: control.paused,
        speed: control.speed,
        seed: control.seed,
        scenario: control.scenario,
        sim_time_s: control.simTimeS,
        heartbeat_at: new Date().toISOString(),
      }),
      "write sim_control",
    );
  }

  async readControl(): Promise<ControlRow> {
    return SupabaseStore.toControl(check(await this.db.from("sim_control").select("*").eq("id", 1).single(), "read sim_control") as Row);
  }

  async popCommands(): Promise<SimCommand[]> {
    const rows = check(
      await this.db.from("sim_commands").select("*").is("consumed_at", null).order("created_at"),
      "read sim_commands",
    ) as Row[];
    if (rows.length === 0) return [];
    check(
      await this.db.from("sim_commands").update({ consumed_at: new Date().toISOString() }).in("id", rows.map((r) => r.id as string)),
      "consume sim_commands",
    );
    return rows.map((r) => ({ kind: "break", positionId: r.position_id as string, failureMode: r.failure_mode as SimCommand["failureMode"] }));
  }

  async initialCursor(): Promise<string> {
    // Use the database's own latest timestamps so client/server clock skew can't hide events.
    const latest = async (table: string, col: string) => {
      const rows = check(
        await this.db.from(table).select(col).not(col, "is", null).order(col, { ascending: false }).limit(1),
        `read ${table}.${col}`,
      ) as unknown as Row[];
      return rows[0]?.[col] as string | undefined;
    };
    const all = await Promise.all([
      latest("tickets", "resolved_at"),
      latest("installed_parts", "installed_at"),
      latest("installed_parts", "removed_at"),
    ]);
    return all.filter((t): t is string => !!t).sort().at(-1) ?? new Date(0).toISOString();
  }

  async readRepairEvents(cursor: string) {
    const [removed, installed, resolved] = await Promise.all([
      this.db.from("installed_parts").select("id, removed_at").gt("removed_at", cursor),
      this.db.from("installed_parts").select("id, position_id, kind, installed_at").gt("installed_at", cursor),
      this.db
        .from("tickets")
        .select("position_id, part_id, resolution_action, resolved_at")
        .eq("status", "resolved")
        .not("position_id", "is", null)
        .not("resolution_action", "is", null)
        .gt("resolved_at", cursor),
    ]);
    const removedRows = check(removed, "read removed parts") as Row[];
    const installedRows = check(installed, "read installed parts") as Row[];
    const resolvedRows = check(resolved, "read resolved tickets") as Row[];

    // The engine needs swaps before resolutions, so "replaced_part" can tell a real swap from a reseat.
    const events: SimEvent[] = [
      ...removedRows.map((r): SimEvent => ({ kind: "part_removed", partId: r.id as string })),
      ...installedRows.map((r): SimEvent => ({
        kind: "part_installed",
        part: { id: r.id as string, positionId: r.position_id as string, kind: r.kind as InvPart["kind"], installedAtS: 0 },
      })),
      ...resolvedRows.map((r): SimEvent => ({
        kind: "resolved",
        positionId: r.position_id as string,
        partId: (r.part_id as string | null) ?? null,
        action: r.resolution_action as ResolutionAction,
      })),
    ];
    const stamps = [
      ...removedRows.map((r) => r.removed_at as string),
      ...installedRows.map((r) => r.installed_at as string),
      ...resolvedRows.map((r) => r.resolved_at as string),
    ];
    return { events, cursor: stamps.length ? [cursor, ...stamps].sort().at(-1)! : cursor };
  }

  async insertAlert(alert: SimAlert, rackId: string): Promise<string> {
    const row = check(
      await this.db
        .from("alerts")
        .insert({
          position_id: alert.positionId,
          device_id: alert.deviceId,
          rack_id: rackId,
          tenant_id: alert.tenantId,
          category: alert.category,
          severity: alert.severity,
          message: alert.message,
        })
        .select("id")
        .single(),
      "insert alert",
    ) as Row;
    return row.id as string;
  }

  async clearAlerts(positionIds: string[]) {
    if (positionIds.length === 0) return;
    check(
      await this.db.from("alerts").update({ cleared_at: new Date().toISOString() }).in("position_id", positionIds).is("cleared_at", null),
      "clear alerts",
    );
  }

  async linkAlert(alertId: string, ticketId: string) {
    check(await this.db.from("alerts").update({ ticket_id: ticketId }).eq("id", alertId), "link alert");
  }

  async findOpenTicket(positionId: string, category: IssueCategory) {
    const rows = check(
      await this.db
        .from("tickets")
        .select("id")
        .eq("position_id", positionId)
        .eq("category", category)
        .in("status", OPEN_STATUSES)
        .limit(1),
      "find open ticket",
    ) as Row[];
    return rows[0] ? { id: rows[0].id as string } : null;
  }

  async countOpenMonitorTickets() {
    const res = await this.db
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("reporter_id", MONITOR_USER_ID)
      .in("status", OPEN_STATUSES);
    if (res.error) throw new Error(`count monitor tickets: ${res.error.message}`);
    return res.count ?? 0;
  }

  async flush(batch: { metrics: Record<string, PositionMetrics>; conditions: ConditionChanges; simTimeS: number }) {
    const now = new Date().toISOString();
    const metricRows = Object.entries(batch.metrics).map(([position_id, metrics]) => ({ position_id, metrics, updated_at: now }));
    for (const part of chunks(metricRows)) {
      check(await this.db.from("position_metrics").upsert(part, { onConflict: "position_id" }), "upsert position_metrics");
    }
    const stateRows = batch.conditions.upserts.map((c) => SupabaseStore.fromCondition(SupabaseStore.key(c), c));
    for (const part of chunks(stateRows)) {
      check(await this.db.from("sim_part_state").upsert(part, { onConflict: "id" }), "upsert sim_part_state");
    }
    if (batch.conditions.deletes.length) {
      check(await this.db.from("sim_part_state").delete().in("id", batch.conditions.deletes), "delete sim_part_state");
    }
    // Only the clock and heartbeat: never clobber paused/speed set from /sim.
    check(
      await this.db.from("sim_control").update({ sim_time_s: batch.simTimeS, heartbeat_at: now }).eq("id", 1),
      "heartbeat",
    );
  }
}

/** The app's HTTP API, called as `user-monitor` (access checks apply, like any other client). */
export class HttpTicketApi implements TicketApi {
  constructor(
    private baseUrl = process.env.SIM_APP_URL ?? "http://localhost:3000",
    private userId = MONITOR_USER_ID,
    private timeoutMs = 60_000,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json", "x-user-id": this.userId },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  draftTicket(reportText: string) {
    return this.call<TicketDraft>("POST", "/api/ai/draft-ticket", { reportText });
  }

  createTicket(draft: TicketDraft & { status: "ai_draft" }) {
    return this.call<{ id: string }>("POST", "/api/tickets", draft);
  }

  async addLog(ticketId: string, entry: { body: string; internal: boolean }) {
    await this.call("POST", `/api/tickets/${ticketId}/log`, entry);
  }
}
