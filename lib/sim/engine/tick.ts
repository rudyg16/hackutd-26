/**
 * Engine entry points: `createState` and `tick` (SIM-SPEC §1, §3).
 * Pure: no I/O, no Math.random, no clock. Same seed + config + commands ⇒ same output.
 */
import { mergeConfig, type DeepPartial, type SimConfig } from "../config";
import { applyBreak, developsDefect, drawInitialConditions, drawMode, drawOnset, drawPartCondition, wearFor, withDefect } from "./defects";
import { detect } from "./detect";
import { baselineMetrics, initialThermal, stepThermal } from "./metrics";
import { applyModes } from "./modes";
import { applyRepairEvents } from "./repair";
import { Rng } from "./rng";
import type {
  PartCondition,
  PositionMetrics,
  ResolvedPin,
  SimCommand,
  SimEvent,
  SimInventory,
  SimState,
  TickResult,
} from "./types";

export interface CreateStateOptions {
  seed: number;
  config?: DeepPartial<SimConfig>;
  /** Sim time to start at (default 0). */
  startTimeS?: number;
  /** Scenario pins (already in sim time) that override the random draw at their positions. */
  pins?: ResolvedPin[];
}

export function createState(inventory: SimInventory, opts: CreateStateOptions): SimState {
  const config = mergeConfig(opts.config);
  const rng = new Rng(opts.seed);
  const simTimeS = opts.startTimeS ?? 0;

  const conditions = drawInitialConditions(inventory, simTimeS, rng, config, opts.pins);
  const thermal = initialThermal(inventory, rng, config);
  const metrics = baselineMetrics(inventory, thermal, 0, rng, config);

  return { seed: opts.seed, simTimeS, rngState: rng.state, config, inventory, conditions, thermal, metrics, signals: {} };
}

export interface RestoreStateOptions {
  seed: number;
  simTimeS: number;
  config?: DeepPartial<SimConfig>;
  /** Hidden conditions saved by a previous process (keyed like `SimState.conditions`). */
  conditions: Record<string, PartCondition>;
}

/**
 * Rebuilds state from persisted conditions (live resume). Parts with no saved row get a fresh
 * draw. The RNG restarts from the seed mixed with the sim clock; resumed runs aren't replayable.
 */
export function restoreState(inventory: SimInventory, opts: RestoreStateOptions): SimState {
  const config = mergeConfig(opts.config);
  const rng = new Rng((opts.seed ^ Math.floor(opts.simTimeS)) >>> 0);
  const conditions: Record<string, PartCondition> = {};
  for (const part of Object.values(inventory.parts)) {
    const saved = opts.conditions[part.id];
    conditions[part.id] = saved ?? drawPartCondition(part, opts.simTimeS, rng, config);
  }
  for (const [key, cond] of Object.entries(opts.conditions)) {
    if (cond.partId === null && inventory.positions[cond.positionId]) conditions[key] = cond;
  }
  const thermal = initialThermal(inventory, rng, config);
  const metrics = baselineMetrics(inventory, thermal, 0, rng, config);
  return { seed: opts.seed, simTimeS: opts.simTimeS, rngState: rng.state, config, inventory, conditions, thermal, metrics, signals: {} };
}

const sameMetrics = (a: PositionMetrics | undefined, b: PositionMetrics) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Advances the simulation by `dtSimS` simulated seconds.
 *
 * `events` are repair feedback from the app (SIM-SPEC §7), applied first so a fix takes
 * effect on this tick's metrics. `commands` are "break" requests from /sim.
 */
export function tick(state: SimState, commands: SimCommand[], events: SimEvent[], dtSimS: number): TickResult {
  const { config } = state;
  const rng = new Rng(state.rngState);
  const simTimeS = state.simTimeS + dtSimS;

  // 0. Repair feedback: reseats, cleans, config changes, part swaps.
  const repaired = applyRepairEvents(state.conditions, state.inventory, events, simTimeS, rng, config);
  const inventory = repaired.inventory;
  let priorSignals = state.signals;
  if (repaired.affectedPositions.length > 0) {
    // A fix or swap wipes the position's history, so a fix that doesn't hold alerts again cleanly.
    priorSignals = { ...state.signals };
    for (const id of repaired.affectedPositions) delete priorSignals[id];
  }

  // Fresh copies of the maps we mutate; the previous state stays untouched.
  const conditions: Record<string, PartCondition> = {};
  for (const [key, c] of Object.entries(repaired.conditions)) conditions[key] = { ...c };

  // 1. Commands ("break" from /sim).
  const rejectedCommands: SimCommand[] = [];
  for (const cmd of commands) {
    if (!applyBreak(conditions, inventory, cmd, simTimeS, rng, config)) rejectedCommands.push(cmd);
  }

  // 2. Wear: age every part and let healthy ones develop new defects over time.
  for (const [key, cond] of Object.entries(conditions)) {
    if (cond.partId === null) continue;
    const part = inventory.parts[cond.partId];
    if (!part) continue;
    cond.wear = wearFor(part, simTimeS, config);
    if (!cond.defect && developsDefect(cond, part.kind, dtSimS, rng, config)) {
      conditions[key] = withDefect(cond, drawMode(part.kind, rng, config), drawOnset(simTimeS, rng, config), rng, config);
    }
  }

  // 3. Metrics: healthy baseline with noise, then active failure modes layered on top.
  const thermal = stepThermal(state.thermal, rng, config);
  const baseline = baselineMetrics(inventory, thermal, dtSimS, rng, config);
  const modes = applyModes({
    inventory,
    conditions,
    baseline,
    prevMetrics: state.metrics,
    signals: priorSignals,
    thermal,
    nowS: simTimeS,
    dtS: dtSimS,
    rng,
    config,
  });
  const metrics = modes.metrics;

  // 4. Detection rules → alerts.
  const detected = detect({ inventory, metrics, signals: modes.signals, nowS: simTimeS, config });

  const changedMetrics: Record<string, PositionMetrics> = {};
  for (const [positionId, m] of Object.entries(metrics)) {
    if (!sameMetrics(state.metrics[positionId], m)) changedMetrics[positionId] = m;
  }

  return {
    state: { ...state, simTimeS, rngState: rng.state, inventory, conditions, thermal, metrics, signals: detected.signals },
    changedMetrics,
    alerts: detected.alerts,
    rejectedCommands,
  };
}
