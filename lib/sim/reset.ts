/**
 * `--reset` (SIM-SPEC §14): wipe run data, restore seeded rows, redraw hidden defects.
 *
 * Rule: anything whose id isn't in seed/base.json was created during a run. One addition to
 * the spec: tickets in seed/demo.json (`tkt-seed-*`, the port-13 history) are seeded too, so
 * they're kept. Reset never touches orgs, users, racks, devices or positions.
 * Caveat: this also deletes tickets, work-log notes and handoffs people added by hand.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import base from "../../seed/base.json";
import demo from "../../seed/demo.json";
import type { DeepPartial, SimConfig } from "./config";
import { SIM_CONFIG } from "./config";
import { createState } from "./engine";
import type { SupabaseStore } from "./adapter";
import { resolvePins, type Scenario } from "./scenarios";

const CHUNK = 200;

const daysAgo = (d: number | null | undefined) =>
  d === null || d === undefined ? null : new Date(Date.now() - d * 86_400_000).toISOString();

function must<T extends { error: { message: string } | null }>(res: T, what: string): T {
  if (res.error) throw new Error(`reset ${what}: ${res.error.message}`);
  return res;
}

async function deleteAllExcept(db: SupabaseClient, table: string, keep: Set<string>, log: (m: string) => void) {
  const ids: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select("id").range(from, from + 999);
    if (error) throw new Error(`reset read ${table}: ${error.message}`);
    ids.push(...(data ?? []).map((r) => r.id as string));
    if (!data || data.length < 1000) break;
  }
  const doomed = ids.filter((id) => !keep.has(id));
  for (let i = 0; i < doomed.length; i += CHUNK) {
    must(await db.from(table).delete().in("id", doomed.slice(i, i + CHUNK)), `delete ${table}`);
  }
  log(`[reset] ${table}: removed ${doomed.length} run-created row(s)`);
}

async function upsertAll(db: SupabaseClient, table: string, rows: object[], log: (m: string) => void) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    must(await db.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict: "id" }), `upsert ${table}`);
  }
  log(`[reset] ${table}: restored ${rows.length} seeded row(s)`);
}

export interface ResetOptions {
  /** Seed for the redraw: explicit, else the scenario's, else the clock. */
  seed?: number;
  scenario?: Scenario;
  speed?: number;
  config?: DeepPartial<SimConfig>;
  log?: (msg: string) => void;
}

export async function resetRun(db: SupabaseClient, store: SupabaseStore, opts: ResetOptions = {}): Promise<number> {
  const log = opts.log ?? (() => {});

  // Sim tables first (alerts point at tickets, sim_part_state at parts).
  for (const table of ["alerts", "sim_commands", "position_metrics", "sim_part_state"]) {
    must(await db.from(table).delete().neq(table === "position_metrics" ? "position_id" : "id", ""), `truncate ${table}`);
  }
  log("[reset] cleared alerts, sim_commands, position_metrics, sim_part_state");

  // 1. Tickets not in the seed (work log and handoffs cascade), 2. replacement parts.
  const seededTicketIds = new Set<string>([...base.tickets, ...demo.tickets].map((t) => t.id));
  await deleteAllExcept(db, "tickets", seededTicketIds, log);
  await deleteAllExcept(db, "work_log", new Set(base.work_log.map((w) => w.id)), log);
  await deleteAllExcept(db, "handoffs", new Set(), log);
  await deleteAllExcept(db, "installed_parts", new Set(base.installed_parts.map((p) => p.id)), log);

  // 3. Re-upsert seeded rows (restores removed_at, assignees, statuses).
  await upsertAll(
    db,
    "installed_parts",
    base.installed_parts.map((p) => ({
      id: p.id,
      position_id: p.positionId,
      kind: p.kind,
      serial: p.serial,
      installed_at: daysAgo(p.installedDaysAgo),
      removed_at: daysAgo(p.removedDaysAgo),
    })),
    log,
  );
  const ticketRow = (t: (typeof base.tickets)[number] | (typeof demo.tickets)[number]) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    severity: t.severity,
    category: t.category,
    tenant_id: t.tenantId,
    rack_id: t.rackId,
    device_id: t.deviceId,
    position_id: t.positionId,
    part_id: t.partId,
    reporter_id: t.reporterId,
    assignee_id: t.assigneeId,
    created_at: daysAgo(t.createdDaysAgo),
    resolved_at: daysAgo(t.resolvedDaysAgo),
    resolution_action: t.resolutionAction,
    resolution_note: t.resolutionNote,
  });
  await upsertAll(db, "tickets", [...base.tickets, ...demo.tickets].map(ticketRow), log);
  await upsertAll(
    db,
    "work_log",
    base.work_log.map((w) => ({
      id: w.id,
      ticket_id: w.ticketId,
      author_id: w.authorId,
      kind: w.kind,
      body: w.body,
      internal: w.internal,
      created_at: daysAgo(w.createdDaysAgo),
    })),
    log,
  );

  // 4–5. Reset the control row and redraw hidden defects.
  const speed = opts.speed ?? SIM_CONFIG.speed;
  const seed = opts.seed ?? opts.scenario?.seed ?? Date.now() % 2 ** 31;
  const inventory = await store.loadInventory();
  const config = { ...opts.scenario?.config, ...opts.config } as DeepPartial<SimConfig>;
  const pins = opts.scenario ? resolvePins(opts.scenario, seed, speed) : undefined;
  const state = createState(inventory, { seed, config, pins });
  await store.startRun(
    { paused: false, speed, seed, scenario: opts.scenario?.name ?? null, simTimeS: 0 },
    state.conditions,
  );
  const defects = Object.values(state.conditions).filter((c) => c.defect).length;
  log(`[reset] redrew ${defects} hidden defect(s) with seed ${seed}`);
  return seed;
}
