// OWNER: Person B. POST /api/parts/:id/replace {serial} -> InstalledPart (the new part)
// Replacing = the old part gets removed_at, a new row is installed, and open tickets on the position get a log entry.
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { toInstalledPart } from "@/db/mappers";
import { canSeeInternal, canSeeTenant, canWorkTenant, getCurrentUser } from "@/lib/access";

export const dynamic = "force-dynamic";

const MAX_SERIAL = 100;

const err = (message: string, status: number) => NextResponse.json({ error: message }, { status });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await getCurrentUser(req);
  } catch {
    return err("unknown user", 401);
  }

  const payload = await req.json().catch(() => null);
  const serial = payload && typeof payload.serial === "string" ? payload.serial.trim() : "";
  if (!serial) return err("serial is required", 400);
  if (serial.length > MAX_SERIAL) return err(`serial must be at most ${MAX_SERIAL} characters`, 400);

  const { id } = await params;
  const { data: part, error } = await db.from("installed_parts").select("*").eq("id", id).maybeSingle();
  if (error) return err(error.message, 500);
  if (!part) return err("part not found", 404);

  // part -> position -> device -> rack gives the owning tenant for the access check.
  const { data: pos } = await db.from("positions").select("id, label, device_id").eq("id", part.position_id).single();
  const { data: dev } = pos ? await db.from("devices").select("rack_id").eq("id", pos.device_id).single() : { data: null };
  const { data: rack } = dev ? await db.from("racks").select("tenant_id").eq("id", dev.rack_id).single() : { data: null };
  if (!pos || !rack) return err("part has no resolvable location", 500);

  if (!canSeeTenant(user, rack.tenant_id)) return err("part not found", 404);
  // Swapping hardware is a NorthMark technician job, not something tenants do.
  if (!canSeeInternal(user) || !canWorkTenant(user, rack.tenant_id)) return err("forbidden", 403);

  if (part.removed_at) return err("part was already replaced", 409);
  if (serial === part.serial) return err("new serial matches the installed part; that is a reseat, not a replacement", 400);

  // Conditional on removed_at so two simultaneous replacements can't both succeed.
  const now = new Date().toISOString();
  const { data: removed, error: rmErr } = await db
    .from("installed_parts")
    .update({ removed_at: now })
    .eq("id", id)
    .is("removed_at", null)
    .select("id")
    .maybeSingle();
  if (rmErr) return err(rmErr.message, 500);
  if (!removed) return err("part was already replaced", 409);

  const { data: fresh, error: insErr } = await db
    .from("installed_parts")
    .insert({ position_id: part.position_id, kind: part.kind, serial, installed_at: now })
    .select("*")
    .single();
  if (insErr) {
    // Put the old part back so the position is never left empty.
    await db.from("installed_parts").update({ removed_at: null }).eq("id", id);
    return err(insErr.message, 500);
  }

  const { data: open } = await db
    .from("tickets")
    .select("id")
    .eq("position_id", part.position_id)
    .in("status", ["open", "in_progress"]);
  if (open && open.length > 0) {
    await db.from("work_log").insert(
      open.map((t) => ({
        ticket_id: t.id,
        author_id: user.id,
        kind: "part_replaced",
        body: `Replaced ${part.kind} at ${pos.label}: ${part.serial} → ${serial}`,
        internal: false,
      })),
    );
  }

  return NextResponse.json(toInstalledPart(fresh), { status: 201 });
}
