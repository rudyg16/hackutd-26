// OWNER: Person C. Position history for AI prompts. Replicates GET /api/positions/:id/history
// (Person B) so the AI routes don't depend on it being live.
import "server-only";
import type { Device, InstalledPart, PositionHistory, Rack, Ticket } from "@/shared/types";
import { db } from "@/db/client";
import { getRepeatFlags } from "@/lib/rules";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const toTicket = (r: any): Ticket => ({
  id: r.id, title: r.title, description: r.description, status: r.status, severity: r.severity,
  category: r.category, tenantId: r.tenant_id, rackId: r.rack_id, deviceId: r.device_id,
  positionId: r.position_id, partId: r.part_id, reporterId: r.reporter_id, assigneeId: r.assignee_id,
  createdAt: r.created_at, resolvedAt: r.resolved_at, resolutionAction: r.resolution_action,
  resolutionNote: r.resolution_note,
});

export const toPart = (r: any): InstalledPart => ({
  id: r.id, positionId: r.position_id, kind: r.kind, serial: r.serial,
  installedAt: r.installed_at, removedAt: r.removed_at,
});

/** PositionHistory plus the owning rack (for access checks). Null if the position doesn't exist. */
export async function loadPositionHistory(
  positionId: string,
): Promise<(PositionHistory & { rack: Rack }) | null> {
  const { data: pos } = await db.from("positions").select("*").eq("id", positionId).maybeSingle();
  if (!pos) return null;

  const [devRes, ticketsRes, partsRes, repeatFlags] = await Promise.all([
    db.from("devices").select("*").eq("id", pos.device_id).single(),
    db.from("tickets").select("*").eq("position_id", positionId).order("created_at", { ascending: false }),
    db.from("installed_parts").select("*").eq("position_id", positionId).order("installed_at", { ascending: false }),
    getRepeatFlags(positionId),
  ]);
  if (devRes.error || !devRes.data) return null;
  const { data: rackRow } = await db.from("racks").select("*").eq("id", devRes.data.rack_id).single();
  if (!rackRow) return null;

  const d = devRes.data;
  const device: Device = {
    id: d.id, rackId: d.rack_id, kind: d.kind, modelId: d.model_id, uPosition: d.u_position, name: d.name,
  };
  const rack: Rack = {
    id: rackRow.id, label: rackRow.label, row: rackRow.row, col: rackRow.col,
    tenantId: rackRow.tenant_id, heightU: rackRow.height_u,
  };
  const partEvents = (partsRes.data ?? []).map(toPart);
  return {
    position: { id: pos.id, deviceId: pos.device_id, localId: pos.local_id, kind: pos.kind, label: pos.label },
    device,
    rack,
    currentParts: partEvents.filter((p) => p.removedAt === null),
    tickets: (ticketsRes.data ?? []).map(toTicket),
    partEvents,
    repeatFlags,
  };
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "-");

/** Plain-text rendering of a position's history for an LLM prompt. */
export function describeHistory(h: PositionHistory, includeNotes: boolean): string {
  const tickets = h.tickets.length
    ? h.tickets
        .map(
          (t) =>
            `- ${day(t.createdAt)} [${t.status}/${t.severity}/${t.category}] ${t.title}` +
            (t.resolutionAction ? ` -> ${t.resolutionAction}` : "") +
            (includeNotes && t.resolutionNote ? ` ("${t.resolutionNote}")` : ""),
        )
        .join("\n")
    : "- none";
  const parts = h.partEvents.length
    ? h.partEvents
        .map((p) => `- ${p.kind} ${p.serial}: installed ${day(p.installedAt)}, removed ${day(p.removedAt)}`)
        .join("\n")
    : "- none";
  const flags = h.repeatFlags.length
    ? h.repeatFlags
        .map((f) => `- ${f.category}: ${f.count} resolved in ${f.windowDays}d since last replacement${f.replaceSuggested ? " (REPLACE SUGGESTED)" : ""}`)
        .join("\n")
    : "- none";
  return `Position: ${h.position.id} (${h.position.label}) on ${h.device.name}\nTickets, newest first:\n${tickets}\nPart history:\n${parts}\nRepeat flags:\n${flags}`;
}
