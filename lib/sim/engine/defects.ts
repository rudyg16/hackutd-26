/**
 * Hidden defect model: wear, per-part draws, position-level `bad_port`, and the
 * per-tenant guarantee (SIM-SPEC §5). Pure — all randomness comes from the passed `Rng`.
 */
import type { PartKind } from "@/shared/types";
import type { DefectKey, SimConfig } from "../config";
import type { Rng } from "./rng";
import {
  conditionKey,
  MODE_TARGET,
  type FailureMode,
  type InvPart,
  type PartCondition,
  type ResolvedPin,
  type SimCommand,
  type SimInventory,
} from "./types";

const DAY_S = 86_400;

/** `wear = 1 + (ageDays / 365) * wearPerYear[kind]` */
export function wearFor(part: InvPart, nowS: number, config: SimConfig): number {
  const ageDays = Math.max(0, (nowS - part.installedAtS) / DAY_S);
  return 1 + (ageDays / 365) * config.wearPerYear[part.kind];
}

export function drawMode(kind: PartKind, rng: Rng, config: SimConfig): FailureMode {
  return rng.weighted(config.modeWeights[kind]) as FailureMode;
}

/** Fresh healthy condition for a part. */
export function healthyCondition(part: InvPart, nowS: number, config: SimConfig): PartCondition {
  return {
    partId: part.id,
    positionId: part.positionId,
    defect: null,
    severity: 0,
    onsetAt: 0,
    wear: wearFor(part, nowS, config),
    suppressedUntil: null,
  };
}

/** Gives `cond` a defect. `onsetAt` is absolute sim-time. */
export function withDefect(cond: PartCondition, mode: FailureMode, onsetAt: number, rng: Rng, config: SimConfig): PartCondition {
  return {
    ...cond,
    defect: mode,
    severity: rng.range(config.severityRange[0], config.severityRange[1]),
    onsetAt,
    suppressedUntil: null,
  };
}

/** Onset spread uniformly over the first `onsetWindowSimMin` from `nowS`. */
export function drawOnset(nowS: number, rng: Rng, config: SimConfig): number {
  return nowS + rng.range(0, config.onsetWindowSimMin * 60);
}

/**
 * Draws a condition for one part. `doa` uses `doaChance` and starts symptoms immediately
 * (a freshly swapped part that is dead on arrival); otherwise `defectChance[kind]`.
 */
export function drawPartCondition(
  part: InvPart,
  nowS: number,
  rng: Rng,
  config: SimConfig,
  opts: { doa?: boolean } = {},
): PartCondition {
  const base = healthyCondition(part, nowS, config);
  const p = opts.doa ? config.doaChance : config.defectChance[part.kind];
  if (!rng.chance(p)) return base;
  const onset = opts.doa ? nowS : drawOnset(nowS, rng, config);
  return withDefect(base, drawMode(part.kind, rng, config), onset, rng, config);
}

function badPortCondition(positionId: string, onsetAt: number, rng: Rng, config: SimConfig): PartCondition {
  return withDefect(
    { partId: null, positionId, defect: null, severity: 0, onsetAt: 0, wear: 1, suppressedUntil: null },
    "bad_port",
    onsetAt,
    rng,
    config,
  );
}

/**
 * Initial draw for the whole inventory: every part, every port (bad_port), then top up
 * until each tenant has at least `minDefectsPerTenant` defects.
 */
export function drawInitialConditions(
  inventory: SimInventory,
  nowS: number,
  rng: Rng,
  config: SimConfig,
  pins: ResolvedPin[] = [],
): Record<string, PartCondition> {
  const conditions: Record<string, PartCondition> = {};

  for (const part of Object.values(inventory.parts)) {
    conditions[conditionKey(part.id, part.positionId)] = drawPartCondition(part, nowS, rng, config);
  }
  for (const pos of Object.values(inventory.positions)) {
    if (pos.kind === "port" && rng.chance(config.defectChance.port)) {
      conditions[conditionKey(null, pos.id)] = badPortCondition(pos.id, drawOnset(nowS, rng, config), rng, config);
    }
  }

  applyPins(conditions, inventory, pins, nowS, config);
  topUpDefects(conditions, inventory, nowS, rng, config);
  return conditions;
}

/**
 * Scenario pins override the random draw at their position: any random defect there is
 * cleared, then the pinned defect is set. Pins count toward the per-tenant minimum.
 */
function applyPins(
  conditions: Record<string, PartCondition>,
  inventory: SimInventory,
  pins: ResolvedPin[],
  nowS: number,
  config: SimConfig,
): void {
  for (const pin of pins) {
    const pos = inventory.positions[pin.positionId];
    if (!pos) throw new Error(`Scenario pin: unknown position ${pin.positionId}`);
    const target = MODE_TARGET[pin.defect];

    // Clear whatever the random draw put at this position.
    delete conditions[conditionKey(null, pos.id)];
    for (const part of Object.values(inventory.parts)) {
      if (part.positionId === pos.id) conditions[conditionKey(part.id, pos.id)] = healthyCondition(part, nowS, config);
    }

    const base: PartCondition = { partId: null, positionId: pos.id, defect: null, severity: 0, onsetAt: 0, wear: 1, suppressedUntil: null };
    if (target === "position") {
      if (pos.kind !== "port") throw new Error(`Scenario pin: ${pin.defect} needs a port, got ${pos.kind} (${pos.id})`);
      conditions[conditionKey(null, pos.id)] = { ...base, defect: pin.defect, severity: pin.severity, onsetAt: pin.onsetAtS };
    } else {
      const part = Object.values(inventory.parts).find((p) => p.positionId === pos.id && p.kind === target);
      if (!part) throw new Error(`Scenario pin: no ${target} at ${pos.id} for ${pin.defect}`);
      conditions[conditionKey(part.id, pos.id)] = {
        ...healthyCondition(part, nowS, config),
        defect: pin.defect,
        severity: pin.severity,
        onsetAt: pin.onsetAtS,
      };
    }
  }
}

/** Enforces `minDefectsPerTenant`: picks a kind weighted by its defect chance, then a random healthy target. */
function topUpDefects(
  conditions: Record<string, PartCondition>,
  inventory: SimInventory,
  nowS: number,
  rng: Rng,
  config: SimConfig,
): void {
  const tenants = [...new Set(Object.values(inventory.devices).map((d) => d.tenantId))].sort();

  for (const tenantId of tenants) {
    const tenantOf = (positionId: string) => inventory.positions[positionId]?.tenantId;
    let count = Object.values(conditions).filter((c) => c.defect && tenantOf(c.positionId) === tenantId).length;

    while (count < config.minDefectsPerTenant) {
      // Healthy candidates grouped by defect kind, only non-empty groups.
      const groups: Partial<Record<DefectKey, string[]>> = {};
      for (const part of Object.values(inventory.parts)) {
        if (tenantOf(part.positionId) !== tenantId) continue;
        const cond = conditions[conditionKey(part.id, part.positionId)];
        if (cond && !cond.defect) (groups[part.kind] ??= []).push(part.id);
      }
      for (const pos of Object.values(inventory.positions)) {
        if (pos.kind === "port" && pos.tenantId === tenantId && !conditions[conditionKey(null, pos.id)]) {
          (groups.port ??= []).push(pos.id);
        }
      }

      const weights: Record<string, number> = {};
      for (const [kind, ids] of Object.entries(groups)) {
        if (ids.length > 0) weights[kind] = config.defectChance[kind as DefectKey];
      }
      if (Object.keys(weights).length === 0) break; // nothing left to break in this tenant

      const kind = rng.weighted(weights) as DefectKey;
      const id = rng.pick(groups[kind]!);
      const onset = drawOnset(nowS, rng, config);
      if (kind === "port") {
        conditions[conditionKey(null, id)] = badPortCondition(id, onset, rng, config);
      } else {
        const part = inventory.parts[id];
        const key = conditionKey(part.id, part.positionId);
        conditions[key] = withDefect(conditions[key], drawMode(part.kind, rng, config), onset, rng, config);
      }
      count++;
    }
  }
}

/**
 * Wear hazard: a healthy part may develop a defect over simulated time.
 * Probability per step is `1 - exp(-hazard * dt)`, hazard per sim-hour = chance * wear * scale.
 */
export function developsDefect(cond: PartCondition, kind: PartKind, dtS: number, rng: Rng, config: SimConfig): boolean {
  const hazardPerHour = config.defectChance[kind] * cond.wear * config.wearHazardScale;
  return rng.chance(1 - Math.exp((-hazardPerHour * dtS) / 3600));
}

/**
 * Applies a `break` command: the position's current part (or the position itself for
 * `bad_port`) gets the defect with onset = now. Returns false if the command doesn't fit.
 */
export function applyBreak(
  conditions: Record<string, PartCondition>,
  inventory: SimInventory,
  cmd: SimCommand,
  nowS: number,
  rng: Rng,
  config: SimConfig,
): boolean {
  const pos = inventory.positions[cmd.positionId];
  if (!pos) return false;
  const target = MODE_TARGET[cmd.failureMode];

  if (target === "position") {
    if (pos.kind !== "port") return false;
    conditions[conditionKey(null, pos.id)] = badPortCondition(pos.id, nowS, rng, config);
    return true;
  }

  const part = Object.values(inventory.parts).find((p) => p.positionId === pos.id && p.kind === target);
  if (!part) return false;
  const key = conditionKey(part.id, pos.id);
  const cond = conditions[key] ?? healthyCondition(part, nowS, config);
  conditions[key] = withDefect(cond, cmd.failureMode, nowS, rng, config);
  return true;
}
