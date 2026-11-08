// OWNER: Person C.
//   GET   /api/sim/control -> { control, alertCount, simTicketCount }   (shift_lead / admin)
//   PATCH /api/sim/control {paused?, speed?} -> control                  (shift_lead / admin)
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { authUser, isSimOperator, jsonError } from "@/lib/sim/route-auth";
import { MONITOR_USER_ID } from "@/lib/sim/pipeline";

export const dynamic = "force-dynamic";

const toControl = (r: Record<string, unknown>) => ({
  paused: Boolean(r.paused),
  speed: Number(r.speed),
  seed: r.seed === null ? null : Number(r.seed),
  scenario: (r.scenario as string | null) ?? null,
  simTimeS: Number(r.sim_time_s),
  heartbeatAt: (r.heartbeat_at as string | null) ?? null,
});

export async function GET(req: NextRequest) {
  const user = await authUser(req);
  if (!user) return jsonError("unknown user", 401);
  if (!isSimOperator(user)) return jsonError("forbidden", 403);

  const { data, error } = await db.from("sim_control").select("*").eq("id", 1).maybeSingle();
  if (error) return jsonError(error.message, 500);

  const [alerts, tickets] = await Promise.all([
    db.from("alerts").select("id", { count: "exact", head: true }),
    db.from("tickets").select("id", { count: "exact", head: true }).eq("reporter_id", MONITOR_USER_ID),
  ]);
  return NextResponse.json({
    control: data ? toControl(data) : null,
    alertCount: alerts.count ?? 0,
    simTicketCount: tickets.count ?? 0,
  });
}

export async function PATCH(req: NextRequest) {
  const user = await authUser(req);
  if (!user) return jsonError("unknown user", 401);
  if (!isSimOperator(user)) return jsonError("forbidden", 403);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return jsonError("invalid JSON body", 400);

  const patch: Record<string, unknown> = {};
  if ("paused" in body) {
    if (typeof body.paused !== "boolean") return jsonError("paused must be a boolean", 400);
    patch.paused = body.paused;
  }
  if ("speed" in body) {
    const speed = Number(body.speed);
    if (!Number.isFinite(speed) || speed < 10 || speed > 600) return jsonError("speed must be between 10 and 600", 400);
    patch.speed = speed;
  }
  if (Object.keys(patch).length === 0) return jsonError("nothing to update", 400);

  const { data, error } = await db.from("sim_control").update(patch).eq("id", 1).select("*").maybeSingle();
  if (error) return jsonError(error.message, 500);
  if (!data) return jsonError("simulator has not started (no sim_control row)", 409);
  return NextResponse.json(toControl(data));
}
