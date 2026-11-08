/**
 * Simulator tunables (SIM-SPEC §15). Pure data — safe to import from the engine.
 * Scenarios override these through `mergeConfig` (SIM-SPEC §11).
 */
import type { PartKind, DeviceKind } from "@/shared/types";

export type DefectKey = PartKind | "port";

/** Idle and max draw of one component (watts). Draw = idleW + (maxW - idleW) * utilisation. */
export interface PartPower {
  idleW: number;
  maxW: number;
}

/** Power and thermal model (docs/POWER-SPEC.md §3, §4, §9). */
export interface PowerConfig {
  /** Device-level load not tied to a position: CPUs, board, switch ASIC. */
  base: Partial<Record<DeviceKind, PartPower>>;
  /**
   * Per-component draw, keyed `<deviceKind>:<kind>` where kind is the position kind, or `uplink`
   * for uplink ports. For fans, `maxW` is the draw at the highest fan speed (cube law below that).
   */
  components: Record<string, PartPower>;
  /** Wall draw = internal load / efficiency; the difference is the PSU conversion loss. */
  psuEfficiency: number;
  utilisation: {
    serverMin: number;
    serverMax: number;
    switch: number;
    /** Random-walk step (sd) per tick and pull back toward the middle (0..1 per tick). */
    stepSd: number;
    revert: number;
  };
  thermal: {
    ambientC: number;
    timeConstantSimMin: number;
    /** Extra silicon draw per °C above `leakageAboveC` (fraction). */
    leakagePerDegC: number;
    leakageAboveC: number;
    maxTempC: number;
    /** Temperature rise scales with 1 / cooling^exponent (airflow is worse than linear). */
    coolingExponent: number;
    /** Healthy fans speed up by this fraction per °C above their baseline (+ deadband), capped at `maxFanSpin`. */
    fanSpinPerDegC: number;
    fanSpinDeadbandC: number;
    maxFanSpin: number;
  };
  limits: {
    rackFactor: number;
    facilityFactor: number;
    warnAt: number;
    criticalAt: number;
    /** Optional explicit overrides (W). */
    rackLimitsW?: Record<string, number>;
    facilityLimitW?: number;
  };
}

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
  power: PowerConfig;
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
  onsetWindowSimMin: 720, // tuned from the spec's 60: spreads first symptoms over 12 sim-h
  doaChance: 0.02,
  minTicketGapSec: 30,
  maxOpenSimTickets: 8,
  wearPerYear: { cable: 0.5, sfp: 0.4, drive: 0.6, fan: 0.5, dimm: 0.2, psu: 0.3 },
  // Tuned with `--dry-run` on the full 42U racks (5.4k parts): ≈20 notable alerts per 24 sim-h ⇒ one
  // every ~70 real s at the default speed of 60. Server parts (drive/fan/dimm) are far rarer per part
  // than the spec table because each server carries ~50 of them; switch cables/SFPs stay near the spec.
  defectChance: { cable: 0.016, sfp: 0.012, drive: 0.0016, fan: 0.0016, dimm: 0.0008, psu: 0.004, port: 0.002 },
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
  power: {
    base: { server: { idleW: 110, maxW: 260 }, switch: { idleW: 55, maxW: 75 } },
    components: {
      "server:dimm_slot": { idleW: 1.4, maxW: 3.2 },
      "server:drive_bay": { idleW: 3.5, maxW: 8 },
      "server:fan_bay": { idleW: 0, maxW: 12 },
      "switch:port": { idleW: 0.25, maxW: 0.6 },
      "switch:uplink": { idleW: 1, maxW: 1.6 },
      "switch:fan_bay": { idleW: 0, maxW: 4 },
    },
    psuEfficiency: 0.94,
    utilisation: { serverMin: 0.3, serverMax: 0.7, switch: 0.5, stepSd: 0.01, revert: 0.02 },
    thermal: {
      ambientC: 22,
      timeConstantSimMin: 8,
      leakagePerDegC: 0.01,
      leakageAboveC: 45,
      maxTempC: 95,
      coolingExponent: 4.5,
      fanSpinPerDegC: 0.01,
      fanSpinDeadbandC: 2,
      maxFanSpin: 1.25,
    },
    // Tuned from the spec's 1.3 / 0.85 (§4): at 1.3 a healthy rack peaked at 79.7% of its limit, right at the
    // 80% "warn" line, and with 0.85 a healthy facility sat at 0.77 / 0.85 = 90% ("warn") at rest.
    // 1.4 / 1.0 leave healthy racks near 72% and the facility near 71%; several hot racks still trip it.
    limits: { rackFactor: 1.4, facilityFactor: 1.0, warnAt: 0.8, criticalAt: 0.95 },
  },
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
