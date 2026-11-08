/**
 * Simulator tunables (SIM-SPEC §15). Pure data — safe to import from the engine.
 * Scenarios override these through `mergeConfig` (SIM-SPEC §11).
 */
import type { PartKind, DeviceKind } from "@/shared/types";

export type DefectKey = PartKind | "port";

/** Failure modes per part kind with relative weights (SIM-SPEC §5 table). */
export type ModeWeights = Record<string, number>;

export interface SimConfig {
  speed: number; // sim-s per real-s
  tickMs: number;
  flushMs: number;
  minDefectsPerTenant: number;
  onsetWindowSimMin: number;
  doaChance: number;
  minTicketGapSec: number; // real seconds
  maxOpenSimTickets: number;
  wearPerYear: Record<PartKind, number>;
  defectChance: Record<DefectKey, number>;
  /** Failure-mode weights for each part kind (position-level `port` is always bad_port). */
  modeWeights: Record<PartKind, ModeWeights>;
  /** Scales the per-sim-hour hazard that a healthy part develops a defect: defectChance * wear * scale. */
  wearHazardScale: number;
  /** Range a defect's `severity` is drawn from. */
  severityRange: [number, number];
  /** Healthy device temperature baseline range (°C) and drift amplitude. */
  baselineTempC: [number, number];
  tempDriftC: number;
  /** Nominal fan rpm by device kind, and healthy jitter (fraction). */
  nominalRpm: Partial<Record<DeviceKind, number>>;
  rpmJitter: number;
  /** Healthy PSU draw (watts) by device kind. */
  nominalWatts: Partial<Record<DeviceKind, number>>;
  /** Healthy single-CRC blips per port per sim-hour. */
  crcBlipsPerHour: number;
  /** Healthy uplink rx power: mean and ± noise (dBm). */
  rxDbmMean: number;
  rxDbmNoise: number;
  /** A rule re-arms only after being quiet this long (sim minutes). */
  alertCooldownSimMin: number;
  /** A rule that keeps firing re-alerts only on a higher severity, or as a reminder this often (sim minutes). */
  alertRepeatSimMin: number;
}

export const SIM_CONFIG: SimConfig = {
  speed: 60,
  tickMs: 1000,
  flushMs: 2000,
  minDefectsPerTenant: 3,
  onsetWindowSimMin: 60,
  doaChance: 0.02,
  minTicketGapSec: 30,
  maxOpenSimTickets: 8,
  wearPerYear: { cable: 0.5, sfp: 0.4, drive: 0.6, fan: 0.5, dimm: 0.2, psu: 0.3 },
  defectChance: { cable: 0.04, sfp: 0.03, drive: 0.02, fan: 0.02, dimm: 0.01, psu: 0.01, port: 0.005 },
  modeWeights: {
    cable: { loose: 0.6, kinked: 0.4 },
    sfp: { dirty_optics: 0.7, failing_laser: 0.3 },
    drive: { media_wear: 1 },
    fan: { bearing_wear: 1 },
    dimm: { failing_rows: 1 },
    psu: { input_fault: 1 },
  },
  wearHazardScale: 0.015,
  severityRange: [0.3, 1],
  baselineTempC: [38, 45],
  tempDriftC: 3,
  nominalRpm: { switch: 9000, server: 7500 },
  rpmJitter: 0.03,
  nominalWatts: { switch: 85, server: 320 },
  crcBlipsPerHour: 1,
  rxDbmMean: -4.5,
  rxDbmNoise: 0.3,
  alertCooldownSimMin: 30,
  alertRepeatSimMin: 240,
};

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Returns a new config with `overrides` merged over `base` (objects merge, arrays/scalars replace). */
export function mergeConfig(overrides: DeepPartial<SimConfig> = {}, base: SimConfig = SIM_CONFIG): SimConfig {
  const merge = (a: unknown, b: unknown): unknown => {
    if (b === undefined) return a;
    if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
      const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
      for (const [k, v] of Object.entries(b as Record<string, unknown>)) out[k] = merge(out[k], v);
      return out;
    }
    return b;
  };
  return merge(base, overrides) as SimConfig;
}
