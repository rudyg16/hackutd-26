// OWNER: Person C. POST /api/ai/draft-handoff {ticketId} -> {note}
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { canSeeInternal, canWorkTenant, getCurrentUser } from "@/lib/access";
import { completeJson } from "@/lib/ai/client";
import { demoFallback } from "@/lib/ai/fallback";
import { describeHistory, loadPositionHistory, toTicket } from "@/lib/ai/history";

export const dynamic = "force-dynamic";

const schema = z.object({ note: z.string().min(1).max(1200) });

const SYSTEM = `You write shift handoff notes for data-center technicians. Given a ticket, its work log and the history of the affected position, write a concise note for the incoming technician (the note is written in first person by the outgoing tech).
Cover, in this order and in plain prose or short lines: what has been done so far, the current state, and what to watch or do next (name specific parts, ports and any pending parts requests). Mention repeat-failure history when it changes what the next tech should do.
Use only facts from the input; do not invent actions, names or times. Keep it under 120 words.
Output JSON with exactly one key: note.`;

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await getCurrentUser(req);
  } catch {
    return NextResponse.json({ error: "unknown user" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const ticketId = typeof body?.ticketId === "string" ? body.ticketId : "";
  if (!ticketId) return NextResponse.json({ error: "ticketId required" }, { status: 400 });

  const { data: row } = await db.from("tickets").select("*").eq("id", ticketId).maybeSingle();
  if (!row) return NextResponse.json({ error: "ticket not found" }, { status: 404 });
  const ticket = toTicket(row);
  if (!canWorkTenant(user, ticket.tenantId) || !canSeeInternal(user)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const [logRes, usersRes, history] = await Promise.all([
    db.from("work_log").select("*").eq("ticket_id", ticketId).order("created_at"),
    db.from("users").select("id,name"),
    ticket.positionId ? loadPositionHistory(ticket.positionId).catch(() => null) : null,
  ]);
  const err = logRes.error ?? usersRes.error;
  if (err) return NextResponse.json({ error: err.message }, { status: 500 });

  const names = new Map((usersRes.data ?? []).map((u) => [u.id as string, u.name as string]));
  const who = (id: string | null) => (id ? (names.get(id) ?? id) : "unassigned");
  const log = (logRes.data ?? []).length
    ? (logRes.data ?? [])
        .map((l) => `- ${String(l.created_at).slice(0, 16).replace("T", " ")} ${who(l.author_id)} [${l.kind}]: ${l.body}`)
        .join("\n")
    : "- none";

  const prompt = [
    `Ticket ${ticket.id}: ${ticket.title}`,
    `Status ${ticket.status}, severity ${ticket.severity}, category ${ticket.category}, assigned to ${who(ticket.assigneeId)}`,
    `Location: ${ticket.positionId ?? ticket.deviceId ?? ticket.rackId}`,
    `Description: ${ticket.description}`,
    `Work log (oldest first):\n${log}`,
    history ? `\n${describeHistory(history, true)}` : "",
  ].join("\n");

  try {
    const out = await completeJson(schema, SYSTEM, prompt, demoFallback<{ note: string }>(`draft-handoff:${ticketId}`));
    return NextResponse.json({ note: out.note });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "draft failed" }, { status: 502 });
  }
}
