/**
 * Power and thermal model (docs/POWER-SPEC.md §3, §4). Pure: no I/O, no Math.random.
 * Runs once per tick after the failure-mode overlay, so it sees real fan speeds.
 *
 * Loop per device: fan health → cooling → temperature (first-order lag) → leakage and fan power
 * → draw → heat. Bounded: temperature is clamped and fans have a top speed, so it always settles.
 */
import models from "../../../seed/device-models.json";
import type { PowerConfig, SimConfig } from "../config";
import type { Rng } from "./rng";
import type {
  DeviceThermal,
  InvPosition,
  PositionMetrics,
  PowerState,
  SimInventory,
} from "./types";

type Group = { kind: string; prefix: string; count: number };
type Model = { faces: Record<string, Group[]> };

const round = (n: number, digits = 0) => Math.round(n * 10 ** digits) / 10 ** digits;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** `<deviceKind>:<kind>` where uplinks get their own kind. */
const kindKey = (kind: string, localId: string) => (kind === "port" && localId.startsWith("uplink") ? "uplink" : kind);

/** Position kinds that are silicon (leak more when hot). */
const SILICON = new Set(["dimm_slot", "port", "uplink"]);

const draw = (p: { idleW: number; maxW: number }, util: number) => p.idleW + (p.maxW - p.idleW) * util;

/** Draw of one fan at `rpm`: cube law, with `maxW` at the highest fan speed. */
export function fanWatts(rpm: number, nominalRpm: number, deviceKind: string, cfg: PowerConfig): number {
  const comp = cfg.components[`${deviceKind}:fan_bay`];
  if (!comp || nominalRpm <= 0) return 0;
  return comp.maxW * (rpm / (nominalRpm * cfg.thermal.maxFanSpin)) ** 3;
}

/** Component counts of a device model, by `kindKey` (e.g. dimm_slot: 32, uplink: 4). */
function modelCounts(modelId: string): Record<string, number> {
  const model = (models.models as Record<string, Model>)[modelId];
  const counts: Record<string, number> = {};
  if (!model) return counts;
  for (const g of Object.values(model.faces).flat()) {
    const key = g.prefix === "uplink" ? "uplink" : g.kind;
    counts[key] = (counts[key] ?? 0) + g.count;
  }
  return counts;
}

const midUtil = (kind: string, cfg: PowerConfig) =>
  kind === "switch" ? cfg.utilisation.switch : (cfg.utilisation.serverMin + cfg.utilisation.serverMax) / 2;

/**
 * Healthy typical wall draw of a device (W): 50% utilisation, every fan at nominal speed, no leakage.
 * It is both the capacity reference (§4) and the thermal calibration point.
 */
export function healthyDeviceDrawW(kind: string, modelId: string, cfg: PowerConfig): number {
  const base = cfg.base[kind as keyof PowerConfig["base"]];
  if (!base) return 0;
  const util = midUtil(kind, cfg);
  let load = draw(base, util);
  for (const [key, n] of Object.entries(modelCounts(modelId))) {
    if (key === "psu_bay") continue;
    if (key === "fan_bay") {
      const comp = cfg.components[`${kind}:fan_bay`];
      if (comp) load += n * comp.maxW * (1 / cfg.thermal.maxFanSpin) ** 3;
      continue;
    }
    const comp = cfg.components[`${kind}:${key}`];
    if (comp) load += n * draw(comp, util);
  }
  return load / cfg.psuEfficiency;
}

export interface PowerLimits {
  /** Healthy typical draw per rack (W). */
  typicalW: Record<string, number>;
  /** Rack limit (W). */
  racksW: Record<string, number>;
  facilityW: number;
}

/** Rack and facility limits: a pure function of the hardware and config (§4). */
export function powerLimits(
  devices: Array<{ rackId: string; kind: string; modelId: string }>,
  cfg: PowerConfig,
): PowerLimits {
  const typicalW: Record<string, number> = {};
  for (const d of devices) typicalW[d.rackId] = (typicalW[d.rackId] ?? 0) + healthyDeviceDrawW(d.kind, d.modelId, cfg);
  const racksW: Record<string, number> = {};
  for (const [rackId, t] of Object.entries(typicalW)) {
    racksW[rackId] = Math.round(cfg.limits.rackLimitsW?.[rackId] ?? t * cfg.limits.rackFactor);
  }
  const facilityW = Math.round(
    cfg.limits.facilityLimitW ?? Object.values(racksW).reduce((a, b) => a + b, 0) * cfg.limits.facilityFactor,
  );
  return { typicalW, racksW, facilityW };
}

export function initialPower(
  inventory: SimInventory,
  thermal: Record<string, DeviceThermal>,
  rng: Rng,
  config: SimConfig,
): PowerState {
  const { utilisation } = config.power;
  const util: Record<string, number> = {};
  const tempC: Record<string, number> = {};
  for (const d of Object.values(inventory.devices)) {
    if (!config.power.base[d.kind as keyof PowerConfig["base"]]) continue;
    const mid = midUtil(d.kind, config.power);
    util[d.id] = d.kind === "switch" ? mid : clamp(mid + rng.range(-0.05, 0.05), utilisation.serverMin, utilisation.serverMax);
    tempC[d.id] = thermal[d.id]?.baseTempC ?? 40;
  }
  return { util, tempC };
}

export interface PowerInput {
  inventory: SimInventory;
  /** Metrics after the failure-mode overlay. Not mutated. */
  metrics: Record<string, PositionMetrics>;
  thermal: Record<string, DeviceThermal>;
  power: PowerState;
  /** Sim seconds since the last step; 0 for the initial snapshot (no temperature or utilisation change). */
  dtS: number;
  rng: Rng;
  config: SimConfig;
}

export function applyPower(input: PowerInput): { metrics: Record<string, PositionMetrics>; power: PowerState } {
  const { inventory, thermal, dtS, rng, config } = input;
  const cfg = config.power;
  const metrics: Record<string, PositionMetrics> = { ...input.metrics };
  const util: Record<string, number> = { ...input.power.util };
  const tempC: Record<string, number> = { ...input.power.tempC };

  const byDevice = new Map<string, InvPosition[]>();
  for (const pos of Object.values(inventory.positions)) {
    const list = byDevice.get(pos.deviceId);
    if (list) list.push(pos);
    else byDevice.set(pos.deviceId, [pos]);
  }
  const hasPart = new Set<string>();
  for (const part of Object.values(inventory.parts)) hasPart.add(part.positionId);

  const refDraw = new Map<string, number>();
  const lag = dtS > 0 ? 1 - Math.exp(-dtS / (cfg.thermal.timeConstantSimMin * 60)) : 0;

  for (const device of Object.values(inventory.devices)) {
    const base = cfg.base[device.kind as keyof PowerConfig["base"]];
    const positions = byDevice.get(device.id);
    if (!base || !positions) continue;

    // 1. Utilisation: slow, mean-reverting walk inside its band (§3.2).
    const [lo, hi] =
      device.kind === "switch"
        ? [cfg.utilisation.switch - 0.03, cfg.utilisation.switch + 0.03]
        : [cfg.utilisation.serverMin, cfg.utilisation.serverMax];
    let u = util[device.id] ?? (lo + hi) / 2;
    if (dtS > 0) {
      const step = device.kind === "switch" ? cfg.utilisation.stepSd / 2 : cfg.utilisation.stepSd;
      u = clamp(u + cfg.utilisation.revert * ((lo + hi) / 2 - u) + step * rng.gaussian(), lo, hi);
    }
    util[device.id] = u;

    // 2. Fan health: healthy fans spin up when the device runs hot; a failed fan stays at 0.
    const baseTemp = thermal[device.id]?.baseTempC ?? 40;
    const tPrev = tempC[device.id] ?? baseTemp;
    const spin = clamp(
      1 + cfg.thermal.fanSpinPerDegC * Math.max(0, tPrev - (baseTemp + cfg.thermal.fanSpinDeadbandC)),
      1,
      cfg.thermal.maxFanSpin,
    );

    let silicon = draw(base, u);
    let other = 0;
    let rpmSum = 0;
    let nominalSum = 0;
    const compW = new Map<string, number>();
    const psus: InvPosition[] = [];

    for (const pos of positions) {
      if (pos.kind === "psu_bay") {
        psus.push(pos);
        continue;
      }
      if (pos.kind === "fan_bay") {
        const m = metrics[pos.id] as Extract<PositionMetrics, { rpm: number }> | undefined;
        if (!m) continue;
        const rpm = Math.max(0, Math.round(m.rpm * spin));
        metrics[pos.id] = { ...m, rpm };
        rpmSum += rpm;
        nominalSum += m.nominalRpm;
        const w = fanWatts(rpm, m.nominalRpm, device.kind, cfg);
        compW.set(pos.id, w);
        other += w;
        continue;
      }
      const comp = cfg.components[`${device.kind}:${kindKey(pos.kind, pos.localId)}`];
      if (!comp) continue;
      const w = draw(comp, u);
      compW.set(pos.id, w);
      if (SILICON.has(kindKey(pos.kind, pos.localId))) silicon += w;
      else other += w;
    }

    // 3. Leakage: silicon draws more above ~45 °C (§3.3 step 5), using last tick's temperature.
    const leakage = 1 + cfg.thermal.leakagePerDegC * Math.max(0, tPrev - cfg.thermal.leakageAboveC);
    const load = silicon * leakage + other;
    // Attribute the extra leakage draw to the silicon components pro rata.
    const siliconScale = silicon > 0 ? leakage : 1;

    // 4. Wall draw, split across installed PSUs that still have input.
    const okPsus = psus.filter((p) => hasPart.has(p.id) && (metrics[p.id] as { psuInput?: string })?.psuInput !== "lost");
    const wall = psus.length > 0 && okPsus.length === 0 ? 0 : load / cfg.psuEfficiency;

    // 5. Temperature: first-order lag toward a steady state set by heat in vs cooling (§3.3).
    const cooling = nominalSum > 0 ? Math.max(0.05, rpmSum / nominalSum) : 1;
    let ref = refDraw.get(device.modelId);
    if (ref === undefined) {
      ref = healthyDeviceDrawW(device.kind, device.modelId, cfg);
      refDraw.set(device.modelId, ref);
    }
    const ambient = cfg.thermal.ambientC;
    const steady = ref > 0
      ? Math.min(cfg.thermal.maxTempC, ambient + ((baseTemp - ambient) * (wall / ref)) / cooling ** cfg.thermal.coolingExponent)
      : baseTemp;
    const tNew = clamp(tPrev + (steady - tPrev) * lag, ambient, cfg.thermal.maxTempC);
    tempC[device.id] = tNew;

    // 6. Write the metrics.
    for (const [positionId, w] of compW) {
      const pos = inventory.positions[positionId];
      const scaled = SILICON.has(kindKey(pos.kind, pos.localId)) ? w * siliconScale : w;
      metrics[positionId] = { ...metrics[positionId], watts: round(scaled, 1) } as PositionMetrics;
    }
    for (const psu of psus) {
      const m = metrics[psu.id] as Extract<PositionMetrics, { psuInput: string }> | undefined;
      if (!m) continue;
      const isOk = okPsus.includes(psu);
      metrics[psu.id] = { ...m, watts: isOk ? round(wall / okPsus.length, 1) : 0 };
    }
    const fan1 = metrics[`${device.id}/fan-1`] as Extract<PositionMetrics, { rpm: number }> | undefined;
    if (fan1 && fan1.tempC !== undefined) {
      // Baseline noise from SIM-SPEC §6 still applies on top of the modelled temperature.
      const noise = (thermal[device.id]?.driftC ?? 0);
      metrics[`${device.id}/fan-1`] = { ...fan1, tempC: round(tNew + noise, 1) };
    }
  }

  return { metrics, power: { util, tempC } };
}
