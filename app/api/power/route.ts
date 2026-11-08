// OWNER: Person C. GET /api/power[?detail=<rackId>] -> PowerSnapshot   (shift_lead / admin)
// Rolls up position_metrics on read. Rack and facility limits are a pure function of the hardware and
// config, so the simulator doesn't need to be running to compute them. `detail` adds per-component
// watts for one rack so the page's regular polling stays cheap.
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { SIM_CONFIG } from "@/lib/sim/config";
import { powerLimits } from "@/lib/sim/engine/power";
import { buildSnapshot } from "@/lib/sim/power-rollup";
import { authUser, isSimOperator, jsonError } from "@/lib/sim/route-auth";

export const dynamic = "force-dynamic";

type MetricRow = { position_id: string; metrics: { watts?: number; tempC?: number } };

export async function GET(req: NextRequest) {
  const user = await authUser(req);
  if (!user) return jsonError("unknown user", 401);
  if (!isSimOperator(user)) return jsonError("forbidden", 403);

  const detailRackId = req.nextUrl.searchParams.get("detail");

  const [racksRes, orgsRes, devicesRes, controlRes] = await Promise.all([
    db.from("racks").select("id, tenant_id"),
    db.from("orgs").select("id, name"),
    db.from("devices").select("id, rack_id, kind, model_id"),
    db.from("sim_control").select("sim_time_s, heartbeat_at").eq("id", 1).maybeSingle(),
  ]);
  const err = racksRes.error ?? orgsRes.error ?? devicesRes.error ?? controlRes.error;
  if (err) return jsonError(err.message, 500);

  const devices = (devicesRes.data ?? []).map((d) => ({ id: d.id as string, rackId: d.rack_id as string, kind: d.kind as string, modelId: d.model_id as string }));

  // Summary needs only PSU rows (draw) and fan-1 rows (temperature): ~300 rows instead of thousands.
  const filters = ["position_id.like.*/psu-*", "position_id.like.*/fan-1"];
  if (detailRackId) {
    for (const d of devices.filter((x) => x.rackId === detailRackId)) filters.push(`position_id.like.${d.id}/*`);
  }
  const metricsRes = await db.from("position_metrics").select("position_id, metrics").or(filters.join(",")).limit(5000);
  if (metricsRes.error) return jsonError(metricsRes.error.message, 500);

  const metrics: Record<string, { watts?: number; tempC?: number }> = {};
  for (const row of (metricsRes.data ?? []) as MetricRow[]) metrics[row.position_id] = row.metrics;

  const limits = powerLimits(devices, SIM_CONFIG.power);
  const snapshot = buildSnapshot({
    racks: (racksRes.data ?? []).map((r) => ({ id: r.id as string, tenantId: r.tenant_id as string })),
    orgs: (orgsRes.data ?? []).map((o) => ({ id: o.id as string, name: o.name as string })),
    devices,
    metrics,
    limits,
    thresholds: SIM_CONFIG.power.limits,
    simTimeS: Number(controlRes.data?.sim_time_s ?? 0),
    heartbeatAt: (controlRes.data?.heartbeat_at as string | null) ?? null,
    detailRackId,
  });
  return NextResponse.json(snapshot);
}
