// OWNER: Person C.
//   GET  /api/handoffs?to=me                  -> Handoff[]  (newest first)
//   POST /api/handoffs {ticketId,toUserId,note} -> Handoff
import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@/shared/types";
import { db } from "@/db/client";
import { canWorkTenant, getCurrentUser, isAssignable } from "@/lib/access";
import { toHandoff } from "@/lib/ai/handoff";

export const dynamic = "force-dynamic";

async function authUser(req: NextRequest): Promise<User | null> {
  try {
    return await getCurrentUser(req);
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const user = await authUser(req);
  if (!user) return NextResponse.json({ error: "unknown user" }, { status: 401 });
  if (req.nextUrl.searchParams.get("to") !== "me") {
    return NextResponse.json({ error: "only ?to=me is supported" }, { status: 400 });
  }

  const { data, error } = await db
    .from("handoffs")
    .select("*")
    .eq("to_user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data ?? []).map(toHandoff));
}

export async function POST(req: NextRequest) {
  const user = await authUser(req);
  if (!user) return NextResponse.json({ error: "unknown user" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const ticketId = typeof body?.ticketId === "string" ? body.ticketId : "";
  const toUserId = typeof body?.toUserId === "string" ? body.toUserId : "";
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (!ticketId || !toUserId || !note) {
    return NextResponse.json({ error: "ticketId, toUserId and note required" }, { status: 400 });
  }

  const { data: ticket } = await db.from("tickets").select("id,tenant_id,assignee_id,status").eq("id", ticketId).maybeSingle();
  if (!ticket) return NextResponse.json({ error: "ticket not found" }, { status: 404 });
  if (!canWorkTenant(user, ticket.tenant_id) || ticket.assignee_id !== user.id) {
    return NextResponse.json({ error: "only the assigned technician can hand off this ticket" }, { status: 403 });
  }
  if (ticket.status === "resolved") return NextResponse.json({ error: "ticket already resolved" }, { status: 409 });
  if (toUserId === user.id) return NextResponse.json({ error: "cannot hand off to yourself" }, { status: 400 });

  const { data: to } = await db.from("users").select("*").eq("id", toUserId).maybeSingle();
  const candidate: User | null = to && {
    id: to.id, name: to.name, email: to.email, orgId: to.org_id, role: to.role,
    approvedTenantIds: to.approved_tenant_ids, avatarColor: to.avatar_color,
  };
  if (!candidate || !isAssignable(candidate, ticket.tenant_id)) {
    return NextResponse.json({ error: "recipient is not approved for this tenant" }, { status: 400 });
  }

  const { data: handoff, error } = await db
    .from("handoffs")
    .insert({ ticket_id: ticketId, from_user_id: user.id, to_user_id: toUserId, note })
    .select("*")
    .single();
  if (error || !handoff) return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 500 });

  const { error: logErr } = await db.from("work_log").insert({
    ticket_id: ticketId,
    author_id: user.id,
    kind: "handoff",
    body: `Handed off to ${candidate.name}: ${note}`,
    internal: true,
  });
  if (logErr) return NextResponse.json({ error: logErr.message }, { status: 500 });

  return NextResponse.json(toHandoff(handoff), { status: 201 });
}
