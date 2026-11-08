/**
 * Engine entry points: `createState` and `tick` (SIM-SPEC §1, §3).
 * Pure: no I/O, no Math.random, no clock. Same seed + config + commands ⇒ same output.
 */
import { mergeConfig, type DeepPartial, type SimConfig } from "../config";
import { applyBreak, developsDefect, drawInitialConditions, drawMode, drawOnset, wearFor, withDefect } from "./defects";
import { detect } from "./detect";
import { baselineMetrics, initialThermal, stepThermal } from "./metrics";
import { applyModes } from "./modes";
import { Rng } from "./rng";
import type {
  PartCondition,
  PositionMetrics,
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
}

export function createState(inventory: SimInventory, opts: CreateStateOptions): SimState {
  const config = mergeConfig(opts.config);
  const rng = new Rng(opts.seed);
  const simTimeS = opts.startTimeS ?? 0;

  const conditions = drawInitialConditions(inventory, simTimeS, rng, config);
  const thermal = initialThermal(inventory, rng, config);
  const metrics = baselineMetrics(inventory, thermal, 0, rng, config);

  return { seed: opts.seed, simTimeS, rngState: rng.state, config, inventory, conditions, thermal, metrics, signals: {} };
}

const sameMetrics = (a: PositionMetrics | undefined, b: PositionMetrics) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Advances the simulation by `dtSimS` simulated seconds.
 *
 * `events` (repair feedback, SIM-SPEC §7) are accepted now so the signature is stable;
 * they are applied by `repair.ts`, which is not wired in yet. */
export function tick(state: SimState, commands: SimCommand[], _events: SimEvent[], dtSimS: number): TickResult {
  const { config, inventory } = state;
  const rng = new Rng(state.rngState);
  const simTimeS = state.simTimeS + dtSimS;

  // Fresh copies of the maps we mutate; the previous state stays untouched.
  const conditions: Record<string, PartCondition> = {};
  for (const [key, c] of Object.entries(state.conditions)) conditions[key] = { ...c };

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
    signals: state.signals,
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
    state: { ...state, simTimeS, rngState: rng.state, conditions, thermal, metrics, signals: detected.signals },
    changedMetrics,
    alerts: detected.alerts,
    rejectedCommands,
  };
}
