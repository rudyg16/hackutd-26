// OWNER: Person B. GET /api/tickets/:id -> { ticket, workLog }   PATCH /api/tickets/:id {status?, assigneeId?} -> Ticket
import { NextResponse, type NextRequest } from "next/server";
import type { TicketStatus, User } from "@/shared/types";
import { db } from "@/db/client";
import { toTicket, toWorkLogEntry } from "@/db/mappers";
import { canSeeInternal, canSeeTenant, canWorkTenant, getCurrentUser, isAssignable } from "@/lib/access";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Statuses a card can be moved to through PATCH. Resolving needs category/action/note, so it goes through /resolve. */
const PATCH_STATUSES: TicketStatus[] = ["ai_draft", "open", "in_progress"];

const err = (message: string, status: number) => NextResponse.json({ error: message }, { status });

async function authenticate(req: NextRequest): Promise<User | null> {
  try {
    return await getCurrentUser(req);
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const user = await authenticate(req);
  if (!user) return err("unknown user", 401);

  const { id } = await params;
  const { data: row, error } = await db.from("tickets").select("*").eq("id", id).maybeSingle();
  if (error) return err(error.message, 500);
  // 404 rather than 403 so tenants can't probe for ticket ids outside their scope.
  if (!row || !canSeeTenant(user, row.tenant_id)) return err("ticket not found", 404);

  const { data: log, error: logErr } = await db
    .from("work_log")
    .select("*")
    .eq("ticket_id", id)
    .order("created_at", { ascending: true });
  if (logErr) return err(logErr.message, 500);

  const workLog = (log ?? []).filter((e) => canSeeInternal(user) || !e.internal).map(toWorkLogEntry);
  return NextResponse.json({ ticket: toTicket(row), workLog });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const user = await authenticate(req);
  if (!user) return err("unknown user", 401);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return err("invalid JSON body", 400);
  const hasStatus = "status" in body;
  const hasAssignee = "assigneeId" in body;
  if (!hasStatus && !hasAssignee) return err("nothing to update", 400);

  const { id } = await params;
  const { data: row, error } = await db.from("tickets").select("*").eq("id", id).maybeSingle();
  if (error) return err(error.message, 500);
  if (!row || !canSeeTenant(user, row.tenant_id)) return err("ticket not found", 404);
  if (!canWorkTenant(user, row.tenant_id)) return err("forbidden", 403);

  const update: Record<string, unknown> = {};

  if (hasStatus) {
    if (!PATCH_STATUSES.includes(body.status)) return err("status must be ai_draft, open or in_progress (use /resolve to resolve)", 400);
    if (row.status === "resolved") return err("ticket is already resolved", 409);
    if (body.status !== row.status) update.status = body.status;
  }

  if (hasAssignee) {
    const assigneeId: string | null = body.assigneeId;
    if (assigneeId !== null && typeof assigneeId !== "string") return err("assigneeId must be a string or null", 400);
    if (row.status === "resolved") return err("ticket is already resolved", 409);

    // Leads and admins assign anyone; technicians may only take a ticket themselves or release their own.
    const isLead = user.role === "shift_lead" || user.role === "admin";
    const selfService = assigneeId === user.id || (assigneeId === null && row.assignee_id === user.id);
    if (!isLead && !selfService) return err("only a shift lead can assign tickets to others", 403);

    if (assigneeId !== null) {
      const { data: cand } = await db.from("users").select("*").eq("id", assigneeId).maybeSingle();
      const candidate = cand && {
        id: cand.id, name: cand.name, email: cand.email, orgId: cand.org_id, role: cand.role,
        approvedTenantIds: cand.approved_tenant_ids, avatarColor: cand.avatar_color,
      } satisfies User;
      if (!candidate || !isAssignable(candidate, row.tenant_id)) {
        return err("assignee is not an approved technician for this tenant", 400);
      }
    }
    if (assigneeId !== row.assignee_id) update.assignee_id = assigneeId;
  }

  if (Object.keys(update).length === 0) return NextResponse.json(toTicket(row));

  const { data: updated, error: updErr } = await db.from("tickets").update(update).eq("id", id).select("*").single();
  if (updErr) return err(updErr.message, 500);

  if (update.status) {
    // Status moves are visible to the tenant; they are part of the ticket's public story.
    const { error: logErr } = await db.from("work_log").insert({
      ticket_id: id,
      author_id: user.id,
      kind: "status_change",
      body: `Status changed from ${row.status} to ${update.status}`,
      internal: false,
    });
    if (logErr) return err(logErr.message, 500);
  }

  return NextResponse.json(toTicket(updated));
}
