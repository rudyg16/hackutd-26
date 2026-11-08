/**
 * Live run loop (SIM-SPEC §1, §3, §7, §9). Depends only on the `SimStore` / `TicketApi`
 * interfaces, so it runs against Supabase in production and an in-memory fake in tests.
 */
import { SIM_CONFIG, type DeepPartial, type SimConfig } from "./config";
import {
  createState,
  restoreState,
  tick,
  type PartCondition,
  type PositionMetrics,
  type SimAlert,
  type SimCommand,
  type SimEvent,
  type SimInventory,
  type SimState,
} from "./engine";
import { resolvePins, type Scenario } from "./scenarios";
import { TicketPipeline, type TicketApi, type TicketStore } from "./pipeline";

export interface ControlRow {
  paused: boolean;
  speed: number;
  seed: number | null;
  scenario: string | null;
  simTimeS: number;
}

export interface ConditionChanges {
  upserts: PartCondition[];
  /** `sim_part_state` ids to delete (parts that were swapped out). */
  deletes: string[];
}

export interface SimStore extends TicketStore {
  loadInventory(): Promise<SimInventory>;
  /** Saved run (control row + hidden conditions), or null if there is none to resume. */
  loadRun(): Promise<{ control: ControlRow; conditions: Record<string, PartCondition> } | null>;
  /** Begins a fresh run: replaces saved conditions and writes the control row. */
  startRun(control: ControlRow, conditions: Record<string, PartCondition>): Promise<void>;
  readControl(): Promise<ControlRow>;
  /** Returns pending `break` commands and marks them consumed. */
  popCommands(): Promise<SimCommand[]>;
  /** Cursor that excludes everything already in the database. */
  initialCursor(): Promise<string>;
  /** Resolved tickets and part changes since `cursor`, in the order the engine needs them. */
  readRepairEvents(cursor: string): Promise<{ events: SimEvent[]; cursor: string }>;
  insertAlert(alert: SimAlert, rackId: string): Promise<string>;
  /** Marks uncleared alerts at these positions as cleared (a repair touched them). */
  clearAlerts(positionIds: string[]): Promise<void>;
  flush(batch: {
    metrics: Record<string, PositionMetrics>;
    conditions: ConditionChanges;
    simTimeS: number;
  }): Promise<void>;
}

export interface RunOptions {
  /** Explicit seed / scenario ⇒ always start a fresh run. Otherwise resume a saved run if there is one. */
  seed?: number;
  scenario?: Scenario;
  speed?: number;
  config?: DeepPartial<SimConfig>;
  log?: (msg: string) => void;
  /** Injectable for tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Stop after this many ticks (tests). */
  maxTicks?: number;
  signal?: AbortSignal;
}

const conditionSnapshot = (c: PartCondition) =>
  JSON.stringify([c.partId, c.positionId, c.defect, c.severity, c.onsetAt, c.suppressedUntil]);

export async function runSim(store: SimStore, api: TicketApi, opts: RunOptions = {}): Promise<SimState> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const inventory = await store.loadInventory();
  const saved = await store.loadRun();
  const fresh = opts.seed !== undefined || opts.scenario !== undefined || !saved;
  let speed = opts.speed ?? saved?.control.speed ?? SIM_CONFIG.speed;
  const config = { ...opts.scenario?.config, ...opts.config } as DeepPartial<SimConfig>;

  let state: SimState;
  if (fresh) {
    const seed = opts.seed ?? opts.scenario?.seed ?? now() % 2 ** 31;
    const pins = opts.scenario ? resolvePins(opts.scenario, seed, speed) : undefined;
    state = createState(inventory, { seed, config, pins });
    await store.startRun(
      { paused: false, speed, seed, scenario: opts.scenario?.name ?? null, simTimeS: 0 },
      state.conditions,
    );
    log(`[sim] new run seed=${seed} speed=${speed}${opts.scenario ? ` scenario=${opts.scenario.name}` : ""}`);
  } else {
    state = restoreState(inventory, {
      seed: saved.control.seed ?? 0,
      simTimeS: saved.control.simTimeS,
      conditions: saved.conditions,
      config,
    });
    log(`[sim] resumed run seed=${saved.control.seed} at sim t=${Math.round(saved.control.simTimeS)}s`);
  }

  const pipeline = new TicketPipeline(store, api, state.config, now, log);
  let queue: Promise<void> = Promise.resolve();

  let cursor = await store.initialCursor();
  const persisted = new Map<string, string>(Object.entries(state.conditions).map(([k, c]) => [k, conditionSnapshot(c)]));
  let dirtyMetrics: Record<string, PositionMetrics> = {};
  let lastFlush = now();
  let ticks = 0;

  const flush = async () => {
    const upserts: PartCondition[] = [];
    const deletes: string[] = [];
    for (const [key, c] of Object.entries(state.conditions)) {
      const snap = conditionSnapshot(c);
      if (persisted.get(key) !== snap) {
        persisted.set(key, snap);
        upserts.push(c);
      }
    }
    for (const key of [...persisted.keys()]) {
      if (!(key in state.conditions)) {
        persisted.delete(key);
        deletes.push(key);
      }
    }
    const metrics = dirtyMetrics;
    dirtyMetrics = {};
    lastFlush = now();
    await store.flush({ metrics, conditions: { upserts, deletes }, simTimeS: state.simTimeS });
  };

  // Initial snapshot so the UI has values before the first change.
  dirtyMetrics = { ...state.metrics };
  await flush();

  while (!opts.signal?.aborted && (opts.maxTicks === undefined || ticks < opts.maxTicks)) {
    const started = now();
    ticks++;

    try {
      const control = await store.readControl();
      speed = control.speed;

      if (!control.paused) {
        const commands = await store.popCommands();
        const repair = await store.readRepairEvents(cursor);
        cursor = repair.cursor;

        const dtSimS = speed * (state.config.tickMs / 1000);
        const r = tick(state, commands, repair.events, dtSimS);
        state = r.state;
        Object.assign(dirtyMetrics, r.changedMetrics);

        for (const cmd of r.rejectedCommands) log(`[sim] rejected command ${JSON.stringify(cmd)}`);
        if (commands.length) log(`[sim] applied ${commands.length - r.rejectedCommands.length} break command(s)`);

        const touched = new Set<string>();
        for (const ev of repair.events) {
          if (ev.kind === "resolved") touched.add(ev.positionId);
          else if (ev.kind === "part_installed") touched.add(ev.part.positionId);
        }
        if (touched.size) await store.clearAlerts([...touched]);

        for (const alert of r.alerts) {
          const device = state.inventory.devices[alert.deviceId];
          const alertId = await store.insertAlert(alert, device.rackId);
          log(`[alert] [${alert.severity}] ${alert.message}`);
          // The LLM call can take seconds: run it off the tick loop, one at a time.
          queue = queue.then(async () => {
            const out = await pipeline.handle(alertId, alert, device);
            if (out.kind !== "failed") log(`[ticket] ${alert.positionId} → ${out.kind}${"ticketId" in out ? ` ${out.ticketId}` : ""}`);
          });
        }
      }

      if (now() - lastFlush >= state.config.flushMs) await flush();
    } catch (e) {
      log(`[sim] tick error: ${e instanceof Error ? e.message : String(e)}`);
    }

    const wait = state.config.tickMs - (now() - started);
    if (wait > 0) await sleep(wait);
  }

  await queue;
  await flush();
  return state;
}
