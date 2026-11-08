/**
 * Builds the /api/power snapshot from rows already read from the database (docs/POWER-SPEC.md §4, §5).
 * Pure and client-safe: no I/O, so it is easy to test and to reuse.
 */
import type { PowerLimits } from "./engine/power";
import type { PowerComponent, PowerDevice, PowerRack, PowerSnapshot, PowerState } from "./api-types";

export interface RollupLimitsConfig {
  warnAt: number;
  criticalAt: number;
}

export interface RollupInput {
  racks: Array<{ id: string; tenantId: string }>;
  orgs: Array<{ id: string; name: string }>;
  devices: Array<{ id: string; rackId: string; kind: string }>;
  /** position_id → metrics. Only rows that carry power data are needed. */
  metrics: Record<string, { watts?: number; tempC?: number } | undefined>;
  limits: PowerLimits;
  thresholds: RollupLimitsConfig;
  simTimeS: number;
  heartbeatAt: string | null;
  /** Fill `components` for this rack's devices only. */
  detailRackId?: string | null;
}

export function powerState(ratio: number, t: RollupLimitsConfig): PowerState {
  if (ratio >= t.criticalAt) return "critical";
  if (ratio >= t.warnAt) return "warn";
  return "ok";
}

/** Position kind from its id (`SRV-C4-01/dimm-A-3` → `dimm_slot`); uplinks keep their own kind. */
export function kindFromPositionId(positionId: string): string {
  const local = positionId.split("/").pop() ?? "";
  if (local.startsWith("uplink")) return "uplink";
  if (local.startsWith("port")) return "port";
  if (local.startsWith("dimm")) return "dimm_slot";
  if (local.startsWith("bay")) return "drive_bay";
  if (local.startsWith("psu")) return "psu_bay";
  if (local.startsWith("fan")) return "fan_bay";
  return "other";
}

const isPsu = (positionId: string) => /\/psu-\d+$/.test(positionId);

export function buildSnapshot(input: RollupInput): PowerSnapshot {
  const { metrics, limits, thresholds } = input;
  const orgName = new Map(input.orgs.map((o) => [o.id, o.name]));

  // Group metric rows by device once.
  const byDevice = new Map<string, Array<[string, { watts?: number; tempC?: number }]>>();
  for (const [positionId, m] of Object.entries(metrics)) {
    if (!m) continue;
    const deviceId = positionId.split("/")[0];
    const list = byDevice.get(deviceId);
    if (list) list.push([positionId, m]);
    else byDevice.set(deviceId, [[positionId, m]]);
  }

  const racks: PowerRack[] = input.racks.map((rack) => {
    const devices: PowerDevice[] = [];
    for (const dev of input.devices.filter((d) => d.rackId === rack.id)) {
      const rows = byDevice.get(dev.id);
      if (!rows) continue; // blank panels, patch panels and PDUs report nothing
      const drawW = rows.filter(([id]) => isPsu(id)).reduce((sum, [, m]) => sum + (m.watts ?? 0), 0);
      const tempC = rows.find(([id]) => id.endsWith("/fan-1"))?.[1].tempC ?? 0;
      const components: PowerComponent[] =
        input.detailRackId === rack.id
          ? rows
              .filter(([, m]) => m.watts !== undefined)
              .map(([positionId, m]) => ({ positionId, kind: kindFromPositionId(positionId), watts: m.watts as number }))
          : [];
      devices.push({ deviceId: dev.id, kind: dev.kind, drawW: Math.round(drawW), tempC, components });
    }
    const drawW = devices.reduce((sum, d) => sum + d.drawW, 0);
    const limitW = limits.racksW[rack.id] ?? 0;
    return {
      rackId: rack.id,
      tenantId: rack.tenantId,
      tenantName: orgName.get(rack.tenantId) ?? rack.tenantId,
      drawW,
      limitW,
      maxTempC: devices.reduce((max, d) => Math.max(max, d.tempC), 0),
      state: limitW > 0 ? powerState(drawW / limitW, thresholds) : "ok",
      devices,
    };
  });
  racks.sort((a, b) => b.drawW - a.drawW);

  const drawW = racks.reduce((sum, r) => sum + r.drawW, 0);
  return {
    facility: {
      drawW,
      limitW: limits.facilityW,
      state: limits.facilityW > 0 ? powerState(drawW / limits.facilityW, thresholds) : "ok",
    },
    racks,
    simTimeS: input.simTimeS,
    heartbeatAt: input.heartbeatAt,
  };
}
