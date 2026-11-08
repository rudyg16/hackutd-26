// OWNER: Person C. POST /api/ai/draft-ticket {reportText} -> TicketDraft
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ISSUE_CATEGORIES, type TicketDraft } from "@/shared/types";
import { db } from "@/db/client";
import { canWorkTenant, getCurrentUser } from "@/lib/access";
import { completeJson } from "@/lib/ai/client";
import { demoFallback, draftTicketKey } from "@/lib/ai/fallback";
import models from "@/seed/device-models.json";

export const dynamic = "force-dynamic";

const draftSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]),
  category: z.enum(ISSUE_CATEGORIES),
  rackId: z.string().min(1),
  deviceId: z.string().nullable(),
  positionId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

type ModelSpec = { faces: Record<string, { prefix: string; count: number }[]> };

/** "port-1..48, uplink-1..4" — compact position id patterns for a device model. */
function positionPatterns(modelId: string): string {
  const spec = (models.models as Record<string, ModelSpec>)[modelId];
  if (!spec) return "none";
  const groups = Object.values(spec.faces).flat();
  return groups.length ? groups.map((g) => `${g.prefix}-1..${g.count}`).join(", ") : "none";
}

const SYSTEM = `You are the ticket-intake assistant for a data-center operations team.
Given a free-text problem report and the floor layout, produce a structured ticket draft.

Rules:
- rackId must be one of the rack ids listed. deviceId must be one of the device ids listed, or null if the report names no specific device. positionId is "<deviceId>/<localId>" using the position id patterns for that device's model (e.g. "SW-C4-01/port-13"), or null if the report names no specific port/slot.
- "top switch" / "top-of-rack switch" means the switch in that rack. "C4" means rack-C4.
- category is one of: ${ISSUE_CATEGORIES.join(", ")}.
- severity: low (cosmetic/no impact), medium (degraded, redundancy intact), high (service-impacting or repeating), critical (outage, overheating, data at risk).
- title: short and specific, include the device and port/slot. description: 1-3 sentences restating the report factually; do not invent details.
- confidence 0..1: how sure you are about the location and category.
Output JSON with exactly these keys: title, description, severity, category, rackId, deviceId, positionId, confidence.`;

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await getCurrentUser(req);
  } catch {
    return NextResponse.json({ error: "unknown user" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const reportText = typeof body?.reportText === "string" ? body.reportText.trim() : "";
  if (!reportText) return NextResponse.json({ error: "reportText required" }, { status: 400 });

  const [racksRes, devicesRes] = await Promise.all([
    db.from("racks").select("id,label,tenant_id"),
    db.from("devices").select("id,rack_id,kind,model_id,name"),
  ]);
  const err = racksRes.error ?? devicesRes.error;
  if (err) return NextResponse.json({ error: err.message }, { status: 500 });

  // Only racks this user may file against are shown to the model (no leaking hidden tenants).
  const racks = (racksRes.data ?? []).filter((r) => canWorkTenant(user, r.tenant_id));
  if (racks.length === 0) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rackIds = new Set(racks.map((r) => r.id));
  const devices = (devicesRes.data ?? []).filter((d) => rackIds.has(d.rack_id));

  const layout = [
    "Racks: " + racks.map((r) => `${r.id} (label ${r.label})`).join(", "),
    "Devices:",
    ...devices.map(
      (d) => `- ${d.id} in ${d.rack_id}: ${d.kind} "${d.name}", position ids: ${positionPatterns(d.model_id)}`,
    ),
  ].join("\n");

  let draft: TicketDraft;
  try {
    draft = await completeJson(
      draftSchema,
      SYSTEM,
      `Floor layout:\n${layout}\n\nReport:\n${reportText}`,
      demoFallback<TicketDraft>(draftTicketKey(reportText)),
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "draft failed" }, { status: 502 });
  }

  // Normalise against real data: never return ids that don't exist or aren't this user's to file on.
  const device = devices.find((d) => d.id === draft.deviceId);
  let positionId: string | null = null;
  if (device && draft.positionId?.startsWith(`${device.id}/`)) {
    const { data } = await db.from("positions").select("id").eq("id", draft.positionId).maybeSingle();
    positionId = data?.id ?? null;
  }
  const rackId = device?.rack_id ?? draft.rackId;
  if (!rackIds.has(rackId)) {
    return NextResponse.json({ error: "could not match report to a rack you can access" }, { status: 422 });
  }

  const out: TicketDraft = {
    ...draft,
    rackId,
    deviceId: device?.id ?? null,
    positionId,
    confidence: device ? draft.confidence : Math.min(draft.confidence, 0.5),
  };
  return NextResponse.json(out);
}
