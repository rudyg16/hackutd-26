/**
 * Dry-run: runs the engine for N simulated minutes as fast as possible, no I/O.
 * Same seed + config + commands ⇒ identical output lines (SIM-SPEC §4).
 */
import { createState, tick, inventoryFromSeed, type SeedLike, type SimCommand, type SimState } from "./engine";
import type { DeepPartial, SimConfig } from "./config";
import { SIM_CONFIG } from "./config";
import { resolvePins, type Scenario } from "./scenarios";

export interface DryRunOptions {
  seed: number;
  minutes: number;
  /** Sim-seconds per real-second (default `SIM_CONFIG.speed`). Sets the tick size. */
  speed?: number;
  config?: DeepPartial<SimConfig>;
  /** Pin conditions and override config from a scenario (explicit `config` wins). */
  scenario?: Scenario;
  /** Also print the hidden defect draw (dev only — hidden state is never shown in the app). */
  xray?: boolean;
  commands?: Array<{ atSimS: number; command: SimCommand }>;
}

export interface DryRunResult {
  lines: string[];
  alerts: number;
  /** First alert per position+category, in sim seconds — what a human would call "notable". */
  notableAtS: number[];
  finalState: SimState;
}

const clock = (s: number) => {
  const t = Math.floor(s);
  const h = String(Math.floor(t / 3600)).padStart(2, "0");
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
  const sec = String(t % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
};

export function dryRun(seedData: SeedLike, opts: DryRunOptions): DryRunResult {
  const speed = opts.speed ?? SIM_CONFIG.speed;
  const inventory = inventoryFromSeed(seedData);
  const config = { ...opts.scenario?.config, ...opts.config } as DeepPartial<SimConfig>;
  const pins = opts.scenario ? resolvePins(opts.scenario, opts.seed, speed) : undefined;
  let state = createState(inventory, { seed: opts.seed, config, pins });
  const dtSimS = speed * (state.config.tickMs / 1000);
  const endS = opts.minutes * 60;

  const lines: string[] = [`seed=${opts.seed} speed=${speed} minutes=${opts.minutes}`];
  if (opts.xray) {
    for (const c of Object.values(state.conditions).filter((c) => c.defect)) {
      lines.push(
        `  [xray] ${c.positionId} ${c.defect} severity=${c.severity.toFixed(2)} onset=+${clock(c.onsetAt)}`,
      );
    }
  }

  const pending = [...(opts.commands ?? [])].sort((a, b) => a.atSimS - b.atSimS);
  const seen = new Set<string>();
  const notableAtS: number[] = [];
  let alerts = 0;

  while (state.simTimeS < endS) {
    const due: SimCommand[] = [];
    while (pending.length && pending[0].atSimS <= state.simTimeS + dtSimS) due.push(pending.shift()!.command);
    const r = tick(state, due, [], dtSimS);
    state = r.state;
    for (const cmd of r.rejectedCommands) lines.push(`+${clock(state.simTimeS)} [rejected] ${JSON.stringify(cmd)}`);
    for (const a of r.alerts) {
      alerts++;
      const key = `${a.positionId}|${a.category}`;
      const tag = seen.has(key) ? "again" : "new";
      if (!seen.has(key)) {
        seen.add(key);
        notableAtS.push(a.simTimeS);
      }
      lines.push(`+${clock(a.simTimeS)} (real ${clock(a.simTimeS / speed)}) [${a.severity}] ${tag}: ${a.message}`);
    }
  }
  lines.push(`done: ${alerts} alerts, ${notableAtS.length} notable`);
  return { lines, alerts, notableAtS, finalState: state };
}
