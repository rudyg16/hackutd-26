// OWNER: Person B. GET /api/tickets?status= -> Ticket[]   POST /api/tickets -> Ticket
import { NextResponse, type NextRequest } from "next/server";
import { ISSUE_CATEGORIES, type Severity, type TicketStatus } from "@/shared/types";
import { db } from "@/db/client";
import { toTicket } from "@/db/mappers";
import { canSeeTenant, canWorkTenant, getCurrentUser } from "@/lib/access";

export const dynamic = "force-dynamic";

const STATUSES: TicketStatus[] = ["ai_draft", "open", "in_progress", "resolved"];
const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];
/** New tickets can only start as a draft or open; resolving goes through /resolve. */
const CREATE_STATUSES: TicketStatus[] = ["ai_draft", "open"];

const err = (message: string, status: number) => NextResponse.json({ error: message }, { status });

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await getCurrentUser(req);
  } catch {
    return err("unknown user", 401);
  }

  const status = req.nextUrl.searchParams.get("status");
  if (status !== null && !STATUSES.includes(status as TicketStatus)) return err(`invalid status: ${status}`, 400);

  let q = db.from("tickets").select("*").order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return err(error.message, 500);

  return NextResponse.json((data ?? []).filter((r) => canSeeTenant(user, r.tenant_id)).map(toTicket));
}

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await getCurrentUser(req);
  } catch {
    return err("unknown user", 401);
  }

  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return err("invalid JSON body", 400);

  if (typeof b.title !== "string" || !b.title.trim()) return err("title is required", 400);
  if (typeof b.rackId !== "string") return err("rackId is required", 400);
  if (!SEVERITIES.includes(b.severity)) return err("invalid severity", 400);
  if (!(ISSUE_CATEGORIES as readonly string[]).includes(b.category)) return err("invalid category", 400);
  if (!CREATE_STATUSES.includes(b.status)) return err("status must be ai_draft or open", 400);

  const deviceId: string | null = b.deviceId ?? null;
  const positionId: string | null = b.positionId ?? null;
  if (positionId && !deviceId) return err("positionId requires deviceId", 400);

  const { data: rack, error: rackErr } = await db.from("racks").select("id, tenant_id").eq("id", b.rackId).maybeSingle();
  if (rackErr) return err(rackErr.message, 500);
  if (!rack) return err("unknown rack", 400);
  if (!canWorkTenant(user, rack.tenant_id)) return err("forbidden", 403);

  // The device must live in this rack and the position on this device.
  if (deviceId) {
    const { data: dev } = await db.from("devices").select("rack_id").eq("id", deviceId).maybeSingle();
    if (!dev || dev.rack_id !== rack.id) return err("device is not in that rack", 400);
  }
  if (positionId) {
    const { data: pos } = await db.from("positions").select("device_id").eq("id", positionId).maybeSingle();
    if (!pos || pos.device_id !== deviceId) return err("position is not on that device", 400);
  }

  const { data, error } = await db
    .from("tickets")
    .insert({
      title: b.title.trim(),
      description: typeof b.description === "string" ? b.description : "",
      status: b.status,
      severity: b.severity,
      category: b.category,
      tenant_id: rack.tenant_id,
      rack_id: rack.id,
      device_id: deviceId,
      position_id: positionId,
      reporter_id: user.id,
    })
    .select("*")
    .single();
  if (error) return err(error.message, 500);

  return NextResponse.json(toTicket(data), { status: 201 });
}
