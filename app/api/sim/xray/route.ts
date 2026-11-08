// OWNER: Person C. GET /api/sim/xray -> XrayRow[]   (admin only)
// The ONLY place hidden simulator state (sim_part_state) leaves the database — SIM-SPEC §17.
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import type { XrayRow } from "@/lib/sim/api-types";
import { authUser, jsonError } from "@/lib/sim/route-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await authUser(req);
  if (!user) return jsonError("unknown user", 401);
  if (user.role !== "admin") return jsonError("forbidden", 403);

  const { data, error } = await db
    .from("sim_part_state")
    .select("id, part_id, position_id, defect, severity, onset_sim_s, suppressed_until_sim_s")
    .not("defect", "is", null)
    .order("onset_sim_s");
  if (error) return jsonError(error.message, 500);

  const rows: XrayRow[] = (data ?? []).map((r) => ({
    id: r.id,
    partId: r.part_id,
    positionId: r.position_id,
    defect: r.defect,
    severity: Number(r.severity),
    onsetSimS: Number(r.onset_sim_s),
    suppressedUntilSimS: r.suppressed_until_sim_s === null ? null : Number(r.suppressed_until_sim_s),
  }));
  return NextResponse.json(rows);
}
