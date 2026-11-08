/**
 * Repair feedback (SIM-SPEC §7): technicians' fixes change what the hidden hardware does next.
 * Pure — returns new conditions/inventory, never mutates its inputs.
 */
import type { SimConfig } from "../config";
import { drawPartCondition } from "./defects";
import type { Rng } from "./rng";
import {
  conditionKey,
  type InvPart,
  type PartCondition,
  type SimEvent,
  type SimInventory,
} from "./types";

const HOUR = 3600;

export interface RepairResult {
  conditions: Record<string, PartCondition>;
  inventory: SimInventory;
  /** Positions whose history should be cleared (a fix, a swap, or a suppression took effect). */
  affectedPositions: string[];
}

const healthy = (c: PartCondition): PartCondition => ({
  ...c,
  defect: null,
  severity: 0,
  onsetAt: 0,
  suppressedUntil: null,
});

const suppress = (c: PartCondition, untilS: number): PartCondition => ({ ...c, suppressedUntil: untilS });

/**
 * Applies events in order. For `resolved` + `replaced_part`: if the position's current part was
 * installed during this run the swap really happened (no effect on the new part); otherwise the
 * technician didn't actually swap anything, so it's treated like `reseated`.
 */
export function applyRepairEvents(
  conditions: Record<string, PartCondition>,
  inventory: SimInventory,
  events: SimEvent[],
  nowS: number,
  rng: Rng,
  config: SimConfig,
): RepairResult {
  const out: Record<string, PartCondition> = { ...conditions };
  const parts: Record<string, InvPart> = { ...inventory.parts };
  const affected = new Set<string>();

  const partsAt = (positionId: string) => Object.values(parts).filter((p) => p.positionId === positionId);

  const removePart = (partId: string) => {
    const part = parts[partId];
    if (!part) return;
    delete parts[partId];
    delete out[conditionKey(partId, part.positionId)];
    affected.add(part.positionId);
  };

  for (const ev of events) {
    switch (ev.kind) {
      case "part_removed":
        removePart(ev.partId);
        break;

      case "part_installed": {
        if (!inventory.positions[ev.part.positionId]) break;
        // One part of a kind per position: anything still there was swapped out.
        for (const old of partsAt(ev.part.positionId)) if (old.kind === ev.part.kind) removePart(old.id);
        const part: InvPart = { ...ev.part, installedAtS: nowS };
        parts[part.id] = part;
        // New part: fresh draw with the DOA chance only. A position-level bad_port is untouched.
        out[conditionKey(part.id, part.positionId)] = drawPartCondition(part, nowS, rng, config, { doa: true });
        affected.add(part.positionId);
        break;
      }

      case "resolved": {
        const here = partsAt(ev.positionId);
        const target = (ev.partId && parts[ev.partId]) || here[0];
        let action = ev.action;
        if (action === "replaced_part") {
          if (here.some((p) => p.installedAtS >= 0)) break; // genuinely swapped this run
          action = "reseated";
        }
        if (action === "other") break;

        if (action === "config_change" || action === "firmware_update") {
          // Suppressed for 1–6 sim-h, cause unchanged — applies to every defect at the position.
          const until = nowS + rng.range(1, 6) * HOUR;
          for (const key of [...here.map((p) => conditionKey(p.id, p.positionId)), conditionKey(null, ev.positionId)]) {
            if (out[key]?.defect) out[key] = suppress(out[key], until);
          }
          affected.add(ev.positionId);
          break;
        }

        if (!target) break;
        const key = conditionKey(target.id, target.positionId);
        const cond = out[key];
        if (!cond?.defect) break;

        if (action === "reseated") {
          if (cond.defect === "loose") {
            out[key] = healthy(cond);
          } else if (cond.defect === "kinked") {
            out[key] = suppress(cond, nowS + rng.range(2, 8) * HOUR);
          } else if (cond.defect === "input_fault") {
            out[key] = rng.chance(0.5) ? healthy(cond) : suppress(cond, nowS + rng.range(1, 4) * HOUR);
          } else {
            break; // anything else: no effect
          }
          affected.add(ev.positionId);
        } else if (action === "cleaned" && cond.defect === "dirty_optics") {
          out[key] = healthy(cond);
          affected.add(ev.positionId);
        }
        break;
      }
    }
  }

  return { conditions: out, inventory: { ...inventory, parts }, affectedPositions: [...affected] };
}
