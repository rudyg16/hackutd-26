/**
 * Failure catalogue (SIM-SPEC §6, §10): how each hidden defect shows up in metrics.
 * `applyModes` overlays active defects on the healthy baseline and keeps the rolling
 * history (`PositionSignals`) that windowed detection rules read.
 */
import type { IssueCategory } from "@/shared/types";
import type { SimConfig } from "../config";
import type { Rng } from "./rng";
import {
  emptySignals,
  type DeviceThermal,
  type FailureMode,
  type PartCondition,
  type PositionMetrics,
  type PositionSignals,
  type SimInventory,
} from "./types";
import { deviceTempC } from "./metrics";

const HOUR = 3600;

/** Category a mode raises, and how long (sim-s) its symptoms take to reach full strength at severity 0. */
export const MODE_INFO: Record<FailureMode, { category: IssueCategory; rampS: number }> = {
  loose: { category: "link_flap", rampS: 0 },
  kinked: { category: "link_flap", rampS: 120 },
  dirty_optics: { category: "crc_errors", rampS: 300 },
  failing_laser: { category: "link_flap", rampS: 4 * HOUR },
  bad_port: { category: "link_flap", rampS: 0 },
  failing_rows: { category: "ecc_memory", rampS: 3 * HOUR },
  media_wear: { category: "disk_failure", rampS: 6 * HOUR },
  bearing_wear: { category: "overheat", rampS: 4 * HOUR },
  input_fault: { category: "psu_fault", rampS: 0 },
};

/** Higher severity progresses faster: ramp = rampS * (1.25 - severity). */
export function progressOf(cond: PartCondition, nowS: number): number {
  if (!cond.defect) return 0;
  const ramp = MODE_INFO[cond.defect].rampS * (1.25 - cond.severity);
  if (ramp <= 0) return 1;
  return Math.min(1, Math.max(0, (nowS - cond.onsetAt) / ramp));
}

/** Symptoms are visible: defective, past onset, and not held off by a reseat/config change. */
export function isActive(cond: PartCondition, nowS: number): boolean {
  if (!cond.defect || nowS < cond.onsetAt) return false;
  return cond.suppressedUntil === null || nowS >= cond.suppressedUntil;
}

export interface ModesInput {
  inventory: SimInventory;
  conditions: Record<string, PartCondition>;
  /** Healthy baseline metrics for this tick (not mutated). */
  baseline: Record<string, PositionMetrics>;
  /** Last tick's metrics — cumulative counters continue from these. */
  prevMetrics: Record<string, PositionMetrics>;
  signals: Record<string, PositionSignals>;
  thermal: Record<string, DeviceThermal>;
  nowS: number;
  dtS: number;
  rng: Rng;
  config: SimConfig;
}

const FLAP_WINDOW_S = 300;
const LOSS_WINDOW_S = 600;
const ECC_WINDOW_S = HOUR;
const round = (n: number, digits = 0) => Math.round(n * 10 ** digits) / 10 ** digits;

export function applyModes(input: ModesInput): {
  metrics: Record<string, PositionMetrics>;
  signals: Record<string, PositionSignals>;
} {
  const { inventory, conditions, baseline, prevMetrics, thermal, nowS, dtS, rng } = input;

  // Active conditions grouped by position, in stable key order.
  const active = new Map<string, PartCondition[]>();
  for (const cond of Object.values(conditions)) {
    if (!isActive(cond, nowS)) continue;
    const list = active.get(cond.positionId) ?? [];
    list.push(cond);
    active.set(cond.positionId, list);
  }

  // Extra device heat from failing fans.
  const extraTemp = new Map<string, number>();
  for (const [positionId, conds] of active) {
    for (const c of conds) {
      if (c.defect !== "bearing_wear") continue;
      const deviceId = inventory.positions[positionId].deviceId;
      extraTemp.set(deviceId, (extraTemp.get(deviceId) ?? 0) + 38 * progressOf(c, nowS));
    }
  }

  const metrics: Record<string, PositionMetrics> = { ...baseline };
  const signals: Record<string, PositionSignals> = { ...input.signals };

  // Positions to process: those with active defects, plus ones with history still decaying.
  const touched = new Set<string>(active.keys());
  for (const [positionId, s] of Object.entries(input.signals)) {
    if (s.flapTimes.length || s.lossTimes.length || s.eccEvents.length || s.downSince !== null) touched.add(positionId);
  }

  for (const positionId of touched) {
    const pos = inventory.positions[positionId];
    if (!pos) continue;
    const conds = active.get(positionId) ?? [];
    const prior = input.signals[positionId] ?? emptySignals();
    const sig: PositionSignals = {
      ...prior,
      flapTimes: prior.flapTimes.filter((t) => t > nowS - FLAP_WINDOW_S),
      lossTimes: prior.lossTimes.filter((t) => t > nowS - LOSS_WINDOW_S),
      eccEvents: prior.eccEvents.filter((e) => e.t > nowS - ECC_WINDOW_S),
      downSince: null,
    };
    const base = baseline[positionId];
    const prev = prevMetrics[positionId];
    const at = (): number => nowS - dtS + rng.next() * dtS; // a time within this tick

    switch (pos.kind) {
      case "port": {
        const b = base as Extract<PositionMetrics, { link: unknown }>;
        let flapsPerMin = 0;
        let crc = b.crcPerMin;
        let rx = b.rxDbm;
        let hardDown = false;
        for (const c of conds) {
          const p = progressOf(c, nowS);
          switch (c.defect) {
            case "loose":
            case "bad_port":
              flapsPerMin += 1 + 3 * c.severity;
              break;
            case "kinked":
              flapsPerMin += 0.5 + 2 * c.severity;
              crc = Math.max(crc, round((10 + 50 * c.severity) * p + rng.range(-2, 2)));
              break;
            case "dirty_optics":
              crc = Math.max(crc, round((25 + 40 * c.severity) * p + rng.range(-2, 2)));
              if (rx !== undefined) rx = round(rx - (7.5 + 3 * c.severity) * p, 2);
              break;
            case "failing_laser":
              crc = Math.max(crc, round(5 * p));
              if (rx !== undefined) rx = round(rx - 12 * p, 2);
              if (p >= 0.95) hardDown = true;
              break;
          }
        }
        const flaps = rng.poisson((flapsPerMin * dtS) / 60);
        for (let i = 0; i < flaps; i++) sig.flapTimes.push(at());
        sig.flapTimes.sort((x, y) => x - y);
        if (hardDown) sig.downSince = prior.downSince ?? nowS;
        const m: PositionMetrics = {
          link: hardDown || (flaps > 0 && rng.chance(0.5)) ? "down" : "up",
          flaps5m: sig.flapTimes.length,
          crcPerMin: crc,
        };
        if (rx !== undefined) m.rxDbm = rx;
        metrics[positionId] = m;
        break;
      }

      case "dimm_slot": {
        const p0 = prev && "eccCorrectable" in prev ? prev : { eccCorrectable: 0, eccUncorrectable: 0 };
        let corr = 0;
        let unc = 0;
        for (const c of conds) {
          if (c.defect !== "failing_rows") continue;
          const p = progressOf(c, nowS);
          const perHour = 10 + 190 * p * (0.4 + 0.6 * c.severity);
          corr += rng.poisson((perHour * dtS) / HOUR);
          const uncPerHour = p > 0.7 ? (4 * (p - 0.7)) / 0.3 : 0;
          unc += rng.poisson((uncPerHour * dtS) / HOUR);
        }
        if (corr > 0) sig.eccEvents.push({ t: nowS, n: corr });
        metrics[positionId] = {
          eccCorrectable: p0.eccCorrectable + corr,
          eccUncorrectable: p0.eccUncorrectable + unc,
        };
        break;
      }

      case "drive_bay": {
        const p0 = prev && "reallocated" in prev ? prev : { reallocated: 0, driveState: "ok" as const };
        let realloc = p0.reallocated;
        let failed = false;
        for (const c of conds) {
          if (c.defect !== "media_wear") continue;
          const p = progressOf(c, nowS);
          realloc += rng.poisson(((8 + 150 * p) * dtS) / HOUR);
          if (p >= 1 && realloc > 50) failed = true;
        }
        metrics[positionId] = {
          reallocated: realloc,
          driveState: failed || p0.driveState === "failed" ? "failed" : realloc > 20 ? "degraded" : "ok",
        };
        break;
      }

      case "fan_bay": {
        const b = base as Extract<PositionMetrics, { rpm: unknown }>;
        let rpm = b.rpm;
        for (const c of conds) {
          if (c.defect === "bearing_wear") rpm = Math.max(0, round(rpm * (1 - progressOf(c, nowS))));
        }
        const m: PositionMetrics = { rpm, nominalRpm: b.nominalRpm };
        if (b.tempC !== undefined) m.tempC = round(deviceTempC(thermal[pos.deviceId]) + (extraTemp.get(pos.deviceId) ?? 0), 1);
        metrics[positionId] = m;
        break;
      }

      case "psu_bay": {
        const b = base as Extract<PositionMetrics, { psuInput: unknown }>;
        let lossesPer10Min = 0;
        for (const c of conds) if (c.defect === "input_fault") lossesPer10Min += 1 + 3 * c.severity;
        const losses = rng.poisson((lossesPer10Min * dtS) / LOSS_WINDOW_S);
        for (let i = 0; i < losses; i++) sig.lossTimes.push(at());
        metrics[positionId] = losses > 0 ? { psuInput: "lost", watts: 0 } : b;
        break;
      }
    }

    signals[positionId] = sig;
  }

  // Heat from failing fans must show even if fan-1 itself is healthy.
  for (const [deviceId, extra] of extraTemp) {
    const id = `${deviceId}/fan-1`;
    const m = metrics[id];
    if (m && "tempC" in m && m.tempC !== undefined && !touched.has(id)) {
      metrics[id] = { ...m, tempC: round(m.tempC + extra, 1) };
    }
  }

  return { metrics, signals };
}
