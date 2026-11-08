// OWNER: Person B. POST /api/tickets/:id/resolve {category, action, note} -> Ticket
import { NextResponse, type NextRequest } from "next/server";
import { ISSUE_CATEGORIES, RESOLUTION_ACTIONS } from "@/shared/types";
import { db } from "@/db/client";
import { toTicket } from "@/db/mappers";
import { canSeeTenant, canWorkTenant, getCurrentUser } from "@/lib/access";

export const dynamic = "force-dynamic";

const err = (message: string, status: number) => NextResponse.json({ error: message }, { status });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await getCurrentUser(req);
  } catch {
    return err("unknown user", 401);
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return err("invalid JSON body", 400);
  if (!(ISSUE_CATEGORIES as readonly string[]).includes(body.category)) return err("invalid category", 400);
  if (!(RESOLUTION_ACTIONS as readonly string[]).includes(body.action)) return err("invalid action", 400);
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!note) return err("note is required", 400);

  const { id } = await params;
  const { data: row, error } = await db.from("tickets").select("*").eq("id", id).maybeSingle();
  if (error) return err(error.message, 500);
  if (!row || !canSeeTenant(user, row.tenant_id)) return err("ticket not found", 404);
  if (!canWorkTenant(user, row.tenant_id)) return err("forbidden", 403);
  if (row.status === "resolved") return err("ticket is already resolved", 409);
  if (row.status === "ai_draft") return err("approve the draft before resolving it", 409);

  // Conditional on status so a double submit can't resolve (and log) twice.
  // The category is updated too: the repeat rule groups by the category it was actually resolved as.
  const { data: updated, error: updErr } = await db
    .from("tickets")
    .update({
      status: "resolved",
      category: body.category,
      resolved_at: new Date().toISOString(),
      resolution_action: body.action,
      resolution_note: note,
    })
    .eq("id", id)
    .neq("status", "resolved")
    .select("*")
    .maybeSingle();
  if (updErr) return err(updErr.message, 500);
  if (!updated) return err("ticket is already resolved", 409);

  const { error: logErr } = await db.from("work_log").insert({
    ticket_id: id,
    author_id: user.id,
    kind: "resolution",
    body: `Resolved (${body.action}): ${note}`,
    internal: false,
  });
  if (logErr) return err(logErr.message, 500);

  return NextResponse.json(toTicket(updated));
}
