// OWNER: Person C. GET /api/sim/metrics/:positionId -> PositionMetricsRow  (access-checked)
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { canSeeTenant } from "@/lib/access";
import type { PositionMetricsRow } from "@/lib/sim/api-types";
import { authUser, jsonError, lookupPosition } from "@/lib/sim/route-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ positionId: string }> }) {
  const user = await authUser(req);
  if (!user) return jsonError("unknown user", 401);

  const positionId = decodeURIComponent((await params).positionId);
  const pos = await lookupPosition(positionId);
  if (!pos) return jsonError("unknown position", 404);
  if (!canSeeTenant(user, pos.tenantId)) return jsonError("forbidden", 403);

  const { data, error } = await db.from("position_metrics").select("metrics, updated_at").eq("position_id", positionId).maybeSingle();
  if (error) return jsonError(error.message, 500);

  // No row yet (simulator never ran) is a normal state, not an error.
  const row: PositionMetricsRow = { positionId, metrics: data?.metrics ?? null, updatedAt: data?.updated_at ?? null };
  return NextResponse.json(row);
}
