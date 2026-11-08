// OWNER: Person B. PATCH /api/users/:id {role?, approvedTenantIds?} -> User   (admin only)
import { NextResponse, type NextRequest } from "next/server";
import type { Role } from "@/shared/types";
import { db } from "@/db/client";
import { toUser } from "@/db/mappers";
import { getCurrentUser } from "@/lib/access";

export const dynamic = "force-dynamic";

const OPERATOR_ROLES: Role[] = ["technician", "shift_lead", "admin"];
const TENANT_ROLES: Role[] = ["tenant_viewer", "tenant_engineer"];
const ALL_ROLES: Role[] = [...TENANT_ROLES, ...OPERATOR_ROLES];

const err = (message: string, status: number) => NextResponse.json({ error: message }, { status });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await getCurrentUser(req);
  } catch {
    return err("unknown user", 401);
  }
  if (actor.role !== "admin") return err("only an admin can edit users", 403);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return err("invalid JSON body", 400);
  const hasRole = "role" in body;
  const hasApprovals = "approvedTenantIds" in body;
  if (!hasRole && !hasApprovals) return err("nothing to update", 400);

  const { id } = await params;
  const { data: row, error } = await db.from("users").select("*").eq("id", id).maybeSingle();
  if (error) return err(error.message, 500);
  if (!row) return err("user not found", 404);

  const { data: org } = await db.from("orgs").select("kind").eq("id", row.org_id).single();
  const isOperator = org?.kind === "operator";

  const update: Record<string, unknown> = {};

  if (hasRole) {
    if (!ALL_ROLES.includes(body.role)) return err("invalid role", 400);
    // A NorthMark employee can't become a tenant viewer or the reverse; that would break their org membership.
    const allowed = isOperator ? OPERATOR_ROLES : TENANT_ROLES;
    if (!allowed.includes(body.role)) {
      return err(`${isOperator ? "NorthMark" : "tenant"} users can only be: ${allowed.join(", ")}`, 400);
    }
    if (row.role === "admin" && body.role !== "admin") {
      // Never leave the system without anyone who can edit users (this also stops an admin demoting themselves).
      const { count } = await db.from("users").select("id", { count: "exact", head: true }).eq("role", "admin").neq("id", id);
      if (!count) return err("cannot remove the last admin", 409);
    }
    if (body.role !== row.role) update.role = body.role;
  }

  if (hasApprovals) {
    const ids = body.approvedTenantIds;
    if (!Array.isArray(ids) || !ids.every((x: unknown) => typeof x === "string")) {
      return err("approvedTenantIds must be an array of tenant org ids", 400);
    }
    const unique = [...new Set<string>(ids)];
    if (!isOperator && unique.length > 0) return err("tenant users cannot have tenant approvals", 400);
    if (unique.length > 0) {
      const { data: tenants } = await db.from("orgs").select("id").eq("kind", "tenant").in("id", unique);
      const known = new Set((tenants ?? []).map((t) => t.id));
      const bad = unique.filter((x) => !known.has(x));
      if (bad.length > 0) return err(`not a tenant org: ${bad.join(", ")}`, 400);
    }
    update.approved_tenant_ids = unique;
  }

  if (Object.keys(update).length === 0) return NextResponse.json(toUser(row));

  const { data: updated, error: updErr } = await db.from("users").update(update).eq("id", id).select("*").single();
  if (updErr) return err(updErr.message, 500);
  return NextResponse.json(toUser(updated));
}
