// OWNER: Person C. POST /api/handoffs/:id/ack -> Handoff. Reassigns the ticket to the receiver.
// Updates tickets.assignee_id directly (same effect as PATCH /api/tickets/:id {assigneeId}).
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { getCurrentUser } from "@/lib/access";
import { toHandoff } from "@/lib/ai/handoff";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await getCurrentUser(req);
  } catch {
    return NextResponse.json({ error: "unknown user" }, { status: 401 });
  }

  const { id } = await params;
  const { data: existing } = await db.from("handoffs").select("*").eq("id", id).maybeSingle();
  if (!existing) return NextResponse.json({ error: "handoff not found" }, { status: 404 });
  if (existing.to_user_id !== user.id) {
    return NextResponse.json({ error: "only the receiver can acknowledge a handoff" }, { status: 403 });
  }
  if (existing.status === "acknowledged") {
    return NextResponse.json({ error: "already acknowledged" }, { status: 409 });
  }

  // Conditional on status so a double-click can't ack twice.
  const { data: acked, error } = await db
    .from("handoffs")
    .update({ status: "acknowledged", acknowledged_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!acked) return NextResponse.json({ error: "already acknowledged" }, { status: 409 });

  const { error: ticketErr } = await db
    .from("tickets")
    .update({ assignee_id: acked.to_user_id })
    .eq("id", acked.ticket_id);
  if (ticketErr) {
    // Roll back so the handoff can be retried.
    await db.from("handoffs").update({ status: "pending", acknowledged_at: null }).eq("id", id);
    return NextResponse.json({ error: ticketErr.message }, { status: 500 });
  }

  return NextResponse.json(toHandoff(acked));
}
