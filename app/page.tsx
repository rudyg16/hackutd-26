"use client";
// OWNER: Person A (3D floor) + side ticket panel slot.
import { useState } from "react";
import FloorScene from "@/components/three/FloorScene";
import GuidedRepair, { cableSwap, sfpSwap } from "@/components/three/GuidedRepair";
import ItemDrawer from "@/components/ai/ItemDrawer";
import { getDeviceModel, layoutModel } from "@/components/three/chassis";
import { USE_SEED, useFloorView } from "@/components/three/useFloorView";
import type { Device, Highlight, Severity } from "@/shared/types";

type Repair = { deviceId: string; kind: "cable" | "sfp"; localId: string };

/**
 * Which guided repairs a device offers: a cable swap on a port that takes a cable, and an SFP swap on one
 * that takes an SFP. Prefers the selected position, then the worst problem position of that type, else the first.
 */
function repairsFor(device: Device, highlights: Highlight[], selectedLocalId: string | null): Repair[] {
  const slots = layoutModel(getDeviceModel(device.modelId));
  const problems = highlights
    .filter((h) => h.deviceId === device.id)
    .sort((a, b) => RANK[b.severity] - RANK[a.severity])
    .map((h) => h.localId);
  const preferred = selectedLocalId ? [selectedLocalId, ...problems] : problems;
  const pick = (ok: (parts: string[]) => boolean) => {
    const ids = slots.filter((s) => ok(s.group.parts)).map((s) => s.localId);
    return preferred.find((id) => ids.includes(id)) ?? ids[0];
  };
  const out: Repair[] = [];
  const cablePort = pick((p) => p.includes("cable") && !p.includes("sfp"));
  const sfpPort = pick((p) => p.includes("sfp"));
  if (cablePort) out.push({ deviceId: device.id, kind: "cable", localId: cablePort });
  if (sfpPort) out.push({ deviceId: device.id, kind: "sfp", localId: sfpPort });
  return out;
}

const RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

const SEV_TEXT: Record<Severity, string> = {
  low: "text-sev-low",
  medium: "text-sev-medium",
  high: "text-sev-high",
  critical: "text-sev-critical",
};

export default function FloorPage() {
  const { floor, error } = useFloorView();
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [selectedLocalId, setSelectedLocalId] = useState<string | null>(null); // e.g. "port-13"
  const [repair, setRepair] = useState<Repair | null>(null);

  /** Select a device (or nothing). A different device closes the position drawer. */
  const selectDevice = (deviceId: string | null) => {
    if (deviceId !== selectedDeviceId) setSelectedLocalId(null);
    setSelectedDeviceId(deviceId);
  };
  /** Select a position: flies to its device and opens the item drawer. */
  const selectPosition = (deviceId: string, localId: string) => {
    setSelectedDeviceId(deviceId);
    setSelectedLocalId(localId);
  };

  // Called by the ticket list when a ticket is clicked. TODO(Person B): pass this to the open-ticket list.
  const onTicketClick = (deviceId: string, positionId?: string | null) => {
    if (positionId?.startsWith(`${deviceId}/`)) selectPosition(deviceId, positionId.slice(deviceId.length + 1));
    else selectDevice(deviceId);
  };

  const selected = floor?.devices.find((d) => d.id === selectedDeviceId) ?? null;
  const selectedRack = floor?.racks.find((r) => r.id === selected?.rackId) ?? null;
  const positionId = selected && selectedLocalId ? `${selected.id}/${selectedLocalId}` : null;
  const repairs = selected && floor ? repairsFor(selected, floor.highlights, selectedLocalId) : [];

  return (
    <div className="grid grid-cols-[1fr_360px] h-[calc(100vh-3rem)]">
      <section className="relative">
        {floor ? (
          <FloorScene
            floor={floor}
            selectedDeviceId={selectedDeviceId}
            selectedLocalId={selectedLocalId}
            onSelectDevice={selectDevice}
            onSelectPosition={selectPosition}
          />
        ) : (
          <p className="p-6 text-dim">{error ? `Couldn't load the floor: ${error}` : "Loading floor…"}</p>
        )}
        {USE_SEED && (
          <span className="absolute right-3 bottom-3 border border-line bg-bg/70 px-2 text-dim">
            seed data (not the live database)
          </span>
        )}
        {repair && (
          <GuidedRepair
            key={`${repair.deviceId}/${repair.kind}/${repair.localId}`}
            deviceId={repair.deviceId}
            steps={repair.kind === "cable" ? cableSwap(repair.localId) : sfpSwap(repair.localId)}
            onDone={() => setRepair(null)}
            onCancel={() => setRepair(null)}
          />
        )}
      </section>

      <aside className="border-l border-line bg-panel p-4 space-y-4 overflow-y-auto">
        {/* TODO(Person B): open-ticket list; clicking a ticket calls onTicketClick(deviceId, positionId) */}
        {positionId && (
          <div className="border-b border-line pb-4">
            <ItemDrawer positionId={positionId} onClose={() => setSelectedLocalId(null)} />
          </div>
        )}
        <h2 className="text-neon-amber neon-text mb-2">Open tickets</h2>

        <div>
          <p className="text-dim mb-1">Selected</p>
          {selected ? (
            <p className="text-neon-cyan">
              {selectedRack?.label} › {selected.id} <span className="text-dim">({selected.name})</span>
            </p>
          ) : (
            <p className="text-dim">Click a rack or device. Click empty floor to clear.</p>
          )}
          {selected && !positionId && (
            <p className="mt-1 text-dim">Click a port, bay, fan or PSU on it to see its history.</p>
          )}
          {repairs.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {repairs.map((r) => (
                <button
                  key={r.kind}
                  className="border border-neon-cyan px-2 py-1 text-neon-cyan"
                  onClick={() => setRepair(r)}
                >
                  Guided {r.kind === "cable" ? "cable swap" : "SFP swap"} · {r.localId}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Stand-in until B's ticket list lands: one row per highlighted position. */}
        <div>
          <p className="text-dim mb-1">Problems on the floor</p>
          <ul className="space-y-1">
            {floor?.highlights.map((h) => (
              <li key={`${h.deviceId}/${h.localId}`}>
                <button
                  className={`hover:underline ${SEV_TEXT[h.severity]}`}
                  onClick={() => onTicketClick(h.deviceId, `${h.deviceId}/${h.localId}`)}
                >
                  {h.deviceId} › {h.localId} · {h.severity}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
