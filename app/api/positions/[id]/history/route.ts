// OWNER: Person B. GET /api/positions/:id/history -> PositionHistory
// Position ids contain a slash ("SW-C4-01/port-13"); clients send them URL-encoded.
import { NextResponse, type NextRequest } from "next/server";
import type { Device, Position, PositionHistory } from "@/shared/types";
import { db } from "@/db/client";
import { toInstalledPart, toTicket } from "@/db/mappers";
import { canSeeTenant, getCurrentUser } from "@/lib/access";
import { getRepeatFlags } from "@/lib/rules";

export const dynamic = "force-dynamic";

const err = (message: string, status: number) => NextResponse.json({ error: message }, { status });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await getCurrentUser(req);
  } catch {
    return err("unknown user", 401);
  }

  const { id: raw } = await params;
  let positionId = raw;
  try {
    positionId = decodeURIComponent(raw);
  } catch {
    // keep the raw value; the lookup below will 404
  }

  const { data: posRow, error } = await db.from("positions").select("*").eq("id", positionId).maybeSingle();
  if (error) return err(error.message, 500);
  if (!posRow) return err("position not found", 404);

  const { data: devRow } = await db.from("devices").select("*").eq("id", posRow.device_id).single();
  const { data: rackRow } = devRow
    ? await db.from("racks").select("tenant_id").eq("id", devRow.rack_id).single()
    : { data: null };
  if (!devRow || !rackRow) return err("position has no resolvable location", 500);

  // 404, not 403, so tenants can't map out which positions exist on other tenants' equipment.
  if (!canSeeTenant(user, rackRow.tenant_id)) return err("position not found", 404);

  const [partsRes, ticketsRes, repeatFlags] = await Promise.all([
    db.from("installed_parts").select("*").eq("position_id", positionId).order("installed_at", { ascending: false }),
    db.from("tickets").select("*").eq("position_id", positionId).order("created_at", { ascending: false }),
    getRepeatFlags(positionId),
  ]);
  const qErr = partsRes.error ?? ticketsRes.error;
  if (qErr) return err(qErr.message, 500);

  const position: Position = {
    id: posRow.id, deviceId: posRow.device_id, localId: posRow.local_id, kind: posRow.kind, label: posRow.label,
  };
  const device: Device = {
    id: devRow.id, rackId: devRow.rack_id, kind: devRow.kind, modelId: devRow.model_id,
    uPosition: devRow.u_position, name: devRow.name,
  };
  const partEvents = (partsRes.data ?? []).map(toInstalledPart);

  const body: PositionHistory = {
    position,
    device,
    currentParts: partEvents.filter((p) => p.removedAt === null),
    tickets: (ticketsRes.data ?? []).map(toTicket),
    partEvents,
    repeatFlags,
  };
  return NextResponse.json(body);
}
