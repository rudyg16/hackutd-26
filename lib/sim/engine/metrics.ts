/**
 * Healthy-hardware metrics with background noise (SIM-SPEC §6 "Background noise", §10).
 * Noise is bounded so it can never cross a detection threshold. Failure signals are
 * layered on top of this baseline by `modes.ts`.
 */
import type { SimConfig } from "../config";
import type { Rng } from "./rng";
import type { DeviceThermal, InvDevice, InvPart, InvPosition, PositionMetrics, SimInventory } from "./types";

const round = (n: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function initialThermal(inventory: SimInventory, rng: Rng, config: SimConfig): Record<string, DeviceThermal> {
  const out: Record<string, DeviceThermal> = {};
  for (const id of Object.keys(inventory.devices)) {
    out[id] = { baseTempC: rng.range(config.baselineTempC[0], config.baselineTempC[1]), driftC: 0 };
  }
  return out;
}

/** Bounded mean-reverting drift of ±`tempDriftC` around each device's baseline. */
export function stepThermal(
  thermal: Record<string, DeviceThermal>,
  rng: Rng,
  config: SimConfig,
): Record<string, DeviceThermal> {
  const out: Record<string, DeviceThermal> = {};
  for (const [id, t] of Object.entries(thermal)) {
    const drift = clamp(t.driftC * 0.85 + rng.gaussian() * 0.8, -config.tempDriftC, config.tempDriftC);
    out[id] = { baseTempC: t.baseTempC, driftC: drift };
  }
  return out;
}

export const deviceTempC = (t: DeviceThermal): number => round(t.baseTempC + t.driftC, 1);

/**
 * Metrics for one position when its hardware is healthy. `dtS` scales the chance of a
 * single-CRC blip (≈ `crcBlipsPerHour` per port); pass 0 for the initial snapshot.
 */
export function baselineMetric(
  pos: InvPosition,
  device: InvDevice,
  part: InvPart | undefined,
  thermal: DeviceThermal,
  dtS: number,
  rng: Rng,
  config: SimConfig,
): PositionMetrics {
  switch (pos.kind) {
    case "port": {
      const blip = dtS > 0 && rng.chance(Math.min(1, (config.crcBlipsPerHour * dtS) / 3600));
      const m: PositionMetrics = { link: "up", flaps5m: 0, crcPerMin: blip ? 1 : 0 };
      if (part?.kind === "sfp") {
        m.rxDbm = round(config.rxDbmMean + rng.range(-config.rxDbmNoise, config.rxDbmNoise), 2);
      }
      return m;
    }
    case "dimm_slot":
      return { eccCorrectable: 0, eccUncorrectable: 0 };
    case "drive_bay":
      return { reallocated: 0, driveState: "ok" };
    case "fan_bay": {
      const nominalRpm = config.nominalRpm[device.kind] ?? 8000;
      const m: PositionMetrics = {
        rpm: Math.round(nominalRpm * (1 + rng.range(-config.rpmJitter, config.rpmJitter))),
        nominalRpm,
      };
      if (pos.localId === "fan-1") m.tempC = deviceTempC(thermal);
      return m;
    }
    case "psu_bay": {
      const nominal = config.nominalWatts[device.kind] ?? 200;
      return { psuInput: "ok", watts: Math.round(nominal * (1 + rng.range(-0.02, 0.02))) };
    }
  }
}

/** Baseline metrics for every position. */
export function baselineMetrics(
  inventory: SimInventory,
  thermal: Record<string, DeviceThermal>,
  dtS: number,
  rng: Rng,
  config: SimConfig,
): Record<string, PositionMetrics> {
  const partAt = new Map<string, InvPart>();
  for (const part of Object.values(inventory.parts)) partAt.set(part.positionId, part);

  const out: Record<string, PositionMetrics> = {};
  for (const pos of Object.values(inventory.positions)) {
    out[pos.id] = baselineMetric(
      pos,
      inventory.devices[pos.deviceId],
      partAt.get(pos.id),
      thermal[pos.deviceId],
      dtS,
      rng,
      config,
    );
  }
  return out;
}
