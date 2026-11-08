// OWNER: Person B. Simulated access control — every API route goes through these.
import "server-only";
import type { NextRequest } from "next/server";
import type { Role, User } from "@/shared/types";
import { USER_HEADER } from "@/shared/api";
import { db } from "@/db/client";

export async function getCurrentUser(req: NextRequest): Promise<User> {
  const id = req.headers.get(USER_HEADER) ?? "user-alex";
  const { data, error } = await db.from("users").select("*").eq("id", id).single();
  if (error || !data) throw new Error(`unknown user ${id}`);
  return {
    id: data.id, name: data.name, email: data.email, orgId: data.org_id, role: data.role,
    approvedTenantIds: data.approved_tenant_ids, avatarColor: data.avatar_color,
  };
}

const OPERATOR_ROLES: Role[] = ["technician", "shift_lead", "admin"];

/** Can this user see anything belonging to tenant `tenantId`? */
export function canSeeTenant(user: User, tenantId: string): boolean {
  if (user.role === "admin" || user.role === "shift_lead") return true;
  if (OPERATOR_ROLES.includes(user.role)) return user.approvedTenantIds.includes(tenantId);
  return user.orgId === tenantId;
}

/** Can this user change tickets for this tenant? */
export function canWorkTenant(user: User, tenantId: string): boolean {
  if (user.role === "tenant_viewer") return false;
  return canSeeTenant(user, tenantId);
}

/** Internal work-log notes are hidden from tenant users. */
export const canSeeInternal = (user: User) => OPERATOR_ROLES.includes(user.role);

/** Who a ticket can be assigned/handed off to: NorthMark techs approved for the tenant. */
export function isAssignable(candidate: User, tenantId: string): boolean {
  return (
    (candidate.role === "technician" || candidate.role === "shift_lead") &&
    candidate.approvedTenantIds.includes(tenantId)
  );
}
