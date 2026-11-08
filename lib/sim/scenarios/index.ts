/**
 * Scenario loader (SIM-SPEC §11). Scenarios are static JSON registered here, so the loader
 * works in tsx and Next alike (no fs). `onsetRealSec` is converted to sim-time with the speed in use.
 */
import type { DeepPartial, SimConfig } from "../config";
import { FAILURE_MODES, MODE_TARGET, type FailureMode, type ResolvedPin } from "../engine/types";
import { Rng } from "../engine/rng";
import demoHeat from "./demo-heat.json";
import demoPort13 from "./demo-port13.json";

export interface ScenarioPin {
  positionId: string;
  target: "part" | "position";
  defect: FailureMode;
  severity: number;
  /** [min, max] real seconds after start until symptoms begin. */
  onsetRealSec: [number, number];
}

export interface Scenario {
  name: string;
  description?: string;
  /** null = use the clock (or --seed). A number pins it. */
  seed: number | null;
  pins: ScenarioPin[];
  config?: DeepPartial<SimConfig>;
}

const REGISTRY: Record<string, unknown> = { "demo-port13": demoPort13, "demo-heat": demoHeat };

export const SCENARIO_NAMES = Object.keys(REGISTRY);

function validate(raw: unknown, name: string): Scenario {
  const s = raw as Scenario;
  if (!s || s.name !== name || !Array.isArray(s.pins)) throw new Error(`Scenario "${name}" is malformed`);
  for (const pin of s.pins) {
    if (!FAILURE_MODES.includes(pin.defect)) throw new Error(`Scenario "${name}": unknown defect "${pin.defect}"`);
    const expected = MODE_TARGET[pin.defect] === "position" ? "position" : "part";
    if (pin.target !== expected) throw new Error(`Scenario "${name}": ${pin.defect} targets a ${expected}, not a ${pin.target}`);
    if (!(pin.severity >= 0 && pin.severity <= 1)) throw new Error(`Scenario "${name}": severity must be 0..1`);
    if (!Array.isArray(pin.onsetRealSec) || pin.onsetRealSec.length !== 2) throw new Error(`Scenario "${name}": onsetRealSec must be [min, max]`);
  }
  return s;
}

export function loadScenario(name: string): Scenario {
  if (!(name in REGISTRY)) throw new Error(`Unknown scenario "${name}". Available: ${SCENARIO_NAMES.join(", ")}`);
  return validate(REGISTRY[name], name);
}

/** Converts pins to sim-time. Onset is drawn from its own RNG stream so pins never disturb the main draw. */
export function resolvePins(scenario: Scenario, seed: number, speed: number): ResolvedPin[] {
  const rng = new Rng((seed ^ 0x9e3779b9) >>> 0);
  return scenario.pins.map((pin) => ({
    positionId: pin.positionId,
    defect: pin.defect,
    severity: pin.severity,
    onsetAtS: rng.range(pin.onsetRealSec[0], pin.onsetRealSec[1]) * speed,
  }));
}
