// OWNER: Person C. GET /api/sim/alerts?limit=20&positionId= -> SimAlertRow[]  (newest first, access-filtered)
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { canSeeTenant } from "@/lib/access";
import type { SimAlertRow } from "@/lib/sim/api-types";
import { authUser, jsonError } from "@/lib/sim/route-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await authUser(req);
  if (!user) return jsonError("unknown user", 401);

  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 20) || 20));
  const positionId = req.nextUrl.searchParams.get("positionId");

  let q = db.from("alerts").select("*").order("created_at", { ascending: false });
  if (positionId) q = q.eq("position_id", positionId);
  // Over-fetch, then filter by tenant access so a restricted user still gets up to `limit` rows.
  const { data, error } = await q.limit(positionId ? limit : limit * 5);
  if (error) return jsonError(error.message, 500);

  const rows: SimAlertRow[] = (data ?? [])
    .filter((r) => canSeeTenant(user, r.tenant_id))
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      positionId: r.position_id,
      deviceId: r.device_id,
      rackId: r.rack_id,
      tenantId: r.tenant_id,
      category: r.category,
      severity: r.severity,
      message: r.message,
      ticketId: r.ticket_id,
      createdAt: r.created_at,
      clearedAt: r.cleared_at,
    }));
  return NextResponse.json(rows);
}
