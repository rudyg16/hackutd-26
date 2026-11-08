// OWNER: Person B. POST /api/tickets/:id/log {body, internal} -> WorkLogEntry
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { toWorkLogEntry } from "@/db/mappers";
import { canSeeInternal, canSeeTenant, canWorkTenant, getCurrentUser } from "@/lib/access";

export const dynamic = "force-dynamic";

const MAX_BODY = 5000;

const err = (message: string, status: number) => NextResponse.json({ error: message }, { status });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await getCurrentUser(req);
  } catch {
    return err("unknown user", 401);
  }

  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== "object") return err("invalid JSON body", 400);
  const text = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!text) return err("body is required", 400);
  if (text.length > MAX_BODY) return err(`body must be at most ${MAX_BODY} characters`, 400);
  if (payload.internal !== undefined && typeof payload.internal !== "boolean") return err("internal must be a boolean", 400);

  // Omitted means "internal" for NorthMark staff and "visible" for tenants, who can't write internal notes at all.
  const internal: boolean = payload.internal ?? canSeeInternal(user);
  if (internal && !canSeeInternal(user)) return err("tenant users cannot write internal notes", 403);

  const { id } = await params;
  const { data: ticket, error } = await db.from("tickets").select("id, tenant_id").eq("id", id).maybeSingle();
  if (error) return err(error.message, 500);
  if (!ticket || !canSeeTenant(user, ticket.tenant_id)) return err("ticket not found", 404);
  if (!canWorkTenant(user, ticket.tenant_id)) return err("forbidden", 403);

  const { data, error: insErr } = await db
    .from("work_log")
    .insert({ ticket_id: id, author_id: user.id, kind: "note", body: text, internal })
    .select("*")
    .single();
  if (insErr) return err(insErr.message, 500);

  return NextResponse.json(toWorkLogEntry(data), { status: 201 });
}
