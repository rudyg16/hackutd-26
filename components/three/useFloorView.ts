"use client";
// OWNER: Person A. Loads the FloorView for the 3D floor.
import { useEffect, useState } from "react";
import base from "@/seed/base.json";
import { api } from "@/shared/api";
import type { Device, FloorView, Highlight, Rack, Severity } from "@/shared/types";

/**
 * true  = build the floor from seed/base.json (the shared DB still has leftover racks and no open tickets).
 * false = GET /api/floor every few seconds (server decides visibility; picks up simulator faults live).
 * Flip to false once the database is reseeded.
 */
export const USE_SEED = true;
const POLL_MS = 5000;

const RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

type SeedTicket = {
  status: string;
  severity: Severity;
  rackId: string;
  deviceId: string | null;
  positionId: string | null;
};

/** Same shape and rules as GET /api/floor, but every rack is visible (the seed has no current user). */
export function seedFloorView(): FloorView {
  const open = (base.tickets as unknown as SeedTicket[]).filter((t) => t.status === "open" || t.status === "in_progress");
  const worst = new Map<string, Severity>();
  const highlights: Highlight[] = [];
  for (const t of open) {
    const cur = worst.get(t.rackId);
    if (!cur || RANK[t.severity] > RANK[cur]) worst.set(t.rackId, t.severity);
    if (t.deviceId && t.positionId) {
      highlights.push({ deviceId: t.deviceId, localId: t.positionId.slice(t.deviceId.length + 1), severity: t.severity });
    }
  }
  return {
    racks: (base.racks as Rack[]).map((r) => ({ ...r, visible: true, worstSeverity: worst.get(r.id) ?? null })),
    devices: base.devices as unknown as Device[],
    highlights,
  };
}

export function useFloorView() {
  const [floor, setFloor] = useState<FloorView | null>(() => (USE_SEED ? seedFloorView() : null));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (USE_SEED) return;
    let alive = true;
    const load = () =>
      api
        .floor()
        .then((f) => {
          if (!alive) return;
          setFloor(f);
          setError(null);
        })
        .catch((e: unknown) => alive && setError(String(e)));
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return { floor, error };
}
