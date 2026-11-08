// OWNER: Person B. GET /api/tickets/:id/assignable -> User[]  (approved NorthMark techs for the ticket's tenant)
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { toUser } from "@/db/mappers";
import { canSeeInternal, canSeeTenant, getCurrentUser, isAssignable } from "@/lib/access";

export const dynamic = "force-dynamic";

const err = (message: string, status: number) => NextResponse.json({ error: message }, { status });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await getCurrentUser(req);
  } catch {
    return err("unknown user", 401);
  }

  const { id } = await params;
  const { data: ticket, error } = await db.from("tickets").select("id, tenant_id").eq("id", id).maybeSingle();
  if (error) return err(error.message, 500);
  if (!ticket || !canSeeTenant(user, ticket.tenant_id)) return err("ticket not found", 404);
  // The list is NorthMark staff; tenants have no business enumerating them.
  if (!canSeeInternal(user)) return err("forbidden", 403);

  const { data, error: usersErr } = await db.from("users").select("*").order("name");
  if (usersErr) return err(usersErr.message, 500);

  return NextResponse.json((data ?? []).map(toUser).filter((u) => isAssignable(u, ticket.tenant_id)));
}
