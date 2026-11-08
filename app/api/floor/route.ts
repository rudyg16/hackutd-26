// OWNER: Person B. GET /api/floor -> FloorView. The server decides visibility; 3D does no access logic.
// Technicians only see racks and problems assigned to them (subject-matter-expert rule); leads and admins see all.
import { NextResponse, type NextRequest } from "next/server";
import type { Device, FloorView, Highlight, Rack, Severity } from "@/shared/types";
import { db } from "@/db/client";
import { canSeeProblem, canSeeTenant, getCurrentUser, seesOnlyAssignedRacks } from "@/lib/access";

export const dynamic = "force-dynamic";

const RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await getCurrentUser(req);
  } catch {
    return NextResponse.json({ error: "unknown user" }, { status: 401 });
  }

  const [racksRes, devicesRes, ticketsRes] = await Promise.all([
    db.from("racks").select("*").order("row").order("col"),
    db.from("devices").select("*"),
    db
      .from("tickets")
      .select("rack_id, device_id, position_id, severity, assignee_id")
      .in("status", ["open", "in_progress"]),
  ]);
  const err = racksRes.error ?? devicesRes.error ?? ticketsRes.error;
  if (err) return NextResponse.json({ error: err.message }, { status: 500 });

  // Simulator alerts that nobody has cleared count like open tickets, so a fault glows as soon as it
  // is detected. If the alerts table isn't there yet (migration 0003 not applied) the floor still works.
  const alertsRes = await db
    .from("alerts")
    .select("rack_id, device_id, position_id, severity")
    .is("cleared_at", null);
  const alerts = alertsRes.error ? [] : (alertsRes.data ?? []);

  // Only the problems this user may see: technicians get their own assigned tickets, leads and admins
  // everything, tenant users their org's. Alerts have no assignee yet, so they go to leads and admins.
  const tenantOf = new Map((racksRes.data ?? []).map((r) => [r.id as string, r.tenant_id as string]));
  const problems = [
    ...(ticketsRes.data ?? []),
    ...alerts.map((a) => ({ ...a, assignee_id: null as string | null })),
  ].filter((p) => {
    const tenantId = tenantOf.get(p.rack_id);
    return tenantId !== undefined && canSeeProblem(user, tenantId, p.assignee_id);
  });
  const racksWithProblems = new Set(problems.map((p) => p.rack_id as string));

  const visibleRackIds = new Set<string>();
  const worst = new Map<string, Severity>();
  const highlights: Highlight[] = [];

  for (const t of problems) {
    const sev = t.severity as Severity;
    const cur = worst.get(t.rack_id);
    if (!cur || RANK[sev] > RANK[cur]) worst.set(t.rack_id, sev);
  }

  const racks: FloorView["racks"] = (racksRes.data ?? []).map((r) => {
    const rack: Rack = {
      id: r.id, label: r.label, row: r.row, col: r.col, tenantId: r.tenant_id, heightU: r.height_u,
    };
    // Technicians see only racks holding work assigned to them; the rest render grey.
    const visible =
      canSeeTenant(user, rack.tenantId) && (!seesOnlyAssignedRacks(user) || racksWithProblems.has(rack.id));
    if (visible) visibleRackIds.add(rack.id);
    return { ...rack, visible, worstSeverity: visible ? (worst.get(rack.id) ?? null) : null };
  });

  const devices: Device[] = (devicesRes.data ?? [])
    .filter((d) => visibleRackIds.has(d.rack_id))
    .map((d) => ({
      id: d.id, rackId: d.rack_id, kind: d.kind, modelId: d.model_id, uPosition: d.u_position, name: d.name,
    }));

  // One highlight per position: a ticket and an alert on the same port show the worse of the two.
  const byPosition = new Map<string, Highlight>();
  for (const t of problems) {
    if (!t.device_id || !t.position_id || !visibleRackIds.has(t.rack_id)) continue;
    const sev = t.severity as Severity;
    const existing = byPosition.get(t.position_id);
    if (existing && RANK[existing.severity] >= RANK[sev]) continue;
    byPosition.set(t.position_id, {
      deviceId: t.device_id,
      localId: t.position_id.slice(t.device_id.length + 1),
      severity: sev,
    });
  }
  highlights.push(...byPosition.values());

  const body: FloorView = { racks, devices, highlights };
  return NextResponse.json(body);
}
