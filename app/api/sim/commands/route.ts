// OWNER: Person C. POST /api/sim/commands {positionId, failureMode} -> {id}   (shift_lead / admin)
// "Break something": the simulator consumes the command on its next tick (onset = now).
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { canSeeTenant } from "@/lib/access";
import { FAILURE_MODES, type FailureMode } from "@/lib/sim/engine/types";
import { authUser, isSimOperator, jsonError, lookupPosition } from "@/lib/sim/route-auth";
import { modesForPosition } from "@/lib/sim/valid-modes";
import type { PositionKind } from "@/shared/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await authUser(req);
  if (!user) return jsonError("unknown user", 401);
  if (!isSimOperator(user)) return jsonError("forbidden", 403);

  const body = await req.json().catch(() => null);
  const positionId = typeof body?.positionId === "string" ? body.positionId : "";
  const failureMode = body?.failureMode as FailureMode;
  if (!positionId) return jsonError("positionId is required", 400);
  if (!FAILURE_MODES.includes(failureMode)) return jsonError("invalid failureMode", 400);

  const pos = await lookupPosition(positionId);
  if (!pos) return jsonError("unknown position", 404);
  if (!canSeeTenant(user, pos.tenantId)) return jsonError("forbidden", 403);
  if (!modesForPosition(pos.kind as PositionKind, pos.localId).includes(failureMode)) {
    return jsonError(`${failureMode} is not valid for ${pos.localId}`, 400);
  }

  const { data, error } = await db
    .from("sim_commands")
    .insert({ kind: "break", position_id: positionId, failure_mode: failureMode, created_by: user.id })
    .select("id")
    .single();
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ id: data.id }, { status: 201 });
}
