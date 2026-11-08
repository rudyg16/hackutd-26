/**
 * Builds a `SimInventory` from seed/base.json-shaped data. Pure transform, no I/O.
 * Sim time 0 is the run start, so `installedDaysAgo` becomes a negative `installedAtS`.
 */
import type { DeviceKind, PartKind, PositionKind } from "@/shared/types";
import type { SimInventory } from "./types";

const DAY_S = 86_400;

export interface SeedLike {
  racks: Array<{ id: string; tenantId: string }>;
  devices: Array<{ id: string; rackId: string; kind: string }>;
  positions: Array<{ id: string; deviceId: string; localId: string; kind: string }>;
  installed_parts: Array<{
    id: string;
    positionId: string;
    kind: string;
    installedDaysAgo: number;
    removedDaysAgo: number | null;
  }>;
}

export function inventoryFromSeed(seed: SeedLike): SimInventory {
  const tenantOfRack = new Map(seed.racks.map((r) => [r.id, r.tenantId]));
  const inventory: SimInventory = { devices: {}, positions: {}, parts: {} };

  for (const d of seed.devices) {
    const tenantId = tenantOfRack.get(d.rackId);
    if (!tenantId) throw new Error(`Device ${d.id}: unknown rack ${d.rackId}`);
    inventory.devices[d.id] = { id: d.id, kind: d.kind as DeviceKind, rackId: d.rackId, tenantId };
  }
  for (const p of seed.positions) {
    const device = inventory.devices[p.deviceId];
    if (!device) continue; // position on a device outside the simulated set
    inventory.positions[p.id] = {
      id: p.id,
      deviceId: p.deviceId,
      localId: p.localId,
      kind: p.kind as PositionKind,
      tenantId: device.tenantId,
    };
  }
  for (const part of seed.installed_parts) {
    if (part.removedDaysAgo !== null) continue; // only currently installed parts are simulated
    if (!inventory.positions[part.positionId]) continue;
    inventory.parts[part.id] = {
      id: part.id,
      positionId: part.positionId,
      kind: part.kind as PartKind,
      installedAtS: -part.installedDaysAgo * DAY_S,
    };
  }
  return inventory;
}
