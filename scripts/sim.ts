/**
 * Hardware simulator CLI (docs/SIM-SPEC.md §2). OWNER: Person C.
 *   tsx scripts/sim.ts                              live sandbox (seed = clock)
 *   tsx scripts/sim.ts --seed 1234                  replay an exact run
 *   tsx scripts/sim.ts --scenario demo-port13       pin scenario conditions (recording)
 *   tsx scripts/sim.ts --speed 120                  sim-seconds per real second (default 60)
 *   tsx scripts/sim.ts --dry-run --minutes 10       print events, no DB writes, as fast as possible
 *   tsx scripts/sim.ts --dry-run --xray             also print the hidden defect draw
 */
import { config as loadEnv } from "dotenv";
import base from "../seed/base.json";
import { SIM_CONFIG } from "../lib/sim/config";
import { dryRun } from "../lib/sim/dryrun";
import type { SeedLike } from "../lib/sim/engine";
import { loadScenario } from "../lib/sim/scenarios";
import { HttpTicketApi, SupabaseStore, createSimDb } from "../lib/sim/adapter";
import { runSim } from "../lib/sim/runner";

export interface CliArgs {
  seed: number | null;
  scenario: string | null;
  speed: number | null;
  dryRun: boolean;
  minutes: number;
  reset: boolean;
  xray: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { seed: null, scenario: null, speed: null, dryRun: false, minutes: 10, reset: false, xray: false };
  const num = (flag: string, v: string | undefined): number => {
    const n = Number(v);
    if (v === undefined || Number.isNaN(n)) throw new Error(`${flag} needs a number`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--seed": args.seed = num(a, argv[++i]); break;
      case "--scenario": args.scenario = argv[++i] ?? null; break;
      case "--speed": args.speed = num(a, argv[++i]); break;
      case "--minutes": args.minutes = num(a, argv[++i]); break;
      case "--dry-run": args.dryRun = true; break;
      case "--reset": args.reset = true; break;
      case "--xray": args.xray = true; break;
      default: throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scenario = args.scenario ? loadScenario(args.scenario) : undefined;
  // Seed priority: --seed, then the scenario's seed, then the clock.
  const seed = args.seed ?? scenario?.seed ?? Date.now() % 2 ** 31;
  const speed = args.speed ?? SIM_CONFIG.speed;

  if (args.dryRun) {
    console.log(`[sim] seed=${seed} speed=${speed}${args.scenario ? ` scenario=${args.scenario}` : ""}`);
    const result = dryRun(base as unknown as SeedLike, { seed, minutes: args.minutes, speed, xray: args.xray, scenario });
    console.log(result.lines.join("\n"));
    return;
  }

  loadEnv({ path: ".env.local" });
  loadEnv(); // falls back to .env
  const store = new SupabaseStore(createSimDb());
  const api = new HttpTicketApi();
  const abort = new AbortController();
  process.on("SIGINT", () => abort.abort());
  process.on("SIGTERM", () => abort.abort());

  // An explicit --seed or --scenario starts a fresh run; otherwise a saved run is resumed.
  await runSim(store, api, {
    seed: args.seed ?? undefined,
    scenario,
    speed: args.speed ?? undefined,
    log: (m) => console.log(m),
    signal: abort.signal,
  });
  console.log("[sim] stopped");
}

// Only run when executed directly (so parseArgs can be imported in tests).
if (process.argv[1] && /sim\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
