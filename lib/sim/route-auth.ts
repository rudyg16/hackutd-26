// OWNER: Person C. Shared guards for app/api/sim/** (server only).
import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@/shared/types";
import { db } from "@/db/client";
import { getCurrentUser } from "@/lib/access";

export const jsonError = (message: string, status: number) => NextResponse.json({ error: message }, { status });

export async function authUser(req: NextRequest): Promise<User | null> {
  try {
    return await getCurrentUser(req);
  } catch {
    return null;
  }
}

/** Control and commands are for shift leads and admins (SIM-SPEC §12). */
export const isSimOperator = (u: User) => u.role === "shift_lead" || u.role === "admin";

export interface PositionInfo {
  id: string;
  localId: string;
  kind: string;
  deviceId: string;
  rackId: string;
  tenantId: string;
}

/** Position plus the tenant that owns it (via device → rack), or null if it doesn't exist. */
export async function lookupPosition(positionId: string): Promise<PositionInfo | null> {
  const { data: pos } = await db.from("positions").select("id, local_id, kind, device_id").eq("id", positionId).maybeSingle();
  if (!pos) return null;
  const { data: dev } = await db.from("devices").select("rack_id").eq("id", pos.device_id).maybeSingle();
  if (!dev) return null;
  const { data: rack } = await db.from("racks").select("tenant_id").eq("id", dev.rack_id).maybeSingle();
  if (!rack) return null;
  return { id: pos.id, localId: pos.local_id, kind: pos.kind, deviceId: pos.device_id, rackId: dev.rack_id, tenantId: rack.tenant_id };
}
