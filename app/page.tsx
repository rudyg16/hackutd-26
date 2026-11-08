"use client";
// OWNER: Person A (3D floor) + side ticket panel slot.
import { useState } from "react";
import FloorScene from "@/components/three/FloorScene";
import { USE_SEED, useFloorView } from "@/components/three/useFloorView";
import type { Severity } from "@/shared/types";

const SEV_TEXT: Record<Severity, string> = {
  low: "text-sev-low",
  medium: "text-sev-medium",
  high: "text-sev-high",
  critical: "text-sev-critical",
};

export default function FloorPage() {
  const { floor, error } = useFloorView();
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  // Called by the ticket list when a ticket is clicked. TODO(Person B): pass this to the open-ticket list.
  const onTicketClick = (deviceId: string) => setSelectedDeviceId(deviceId);

  const selected = floor?.devices.find((d) => d.id === selectedDeviceId) ?? null;
  const selectedRack = floor?.racks.find((r) => r.id === selected?.rackId) ?? null;

  return (
    <div className="grid grid-cols-[1fr_360px] h-[calc(100vh-3rem)]">
      <section className="relative">
        {floor ? (
          <FloorScene floor={floor} selectedDeviceId={selectedDeviceId} onSelectDevice={setSelectedDeviceId} />
        ) : (
          <p className="p-6 text-dim">{error ? `Couldn't load the floor: ${error}` : "Loading floor…"}</p>
        )}
        {USE_SEED && (
          <span className="absolute right-3 bottom-3 border border-line bg-bg/70 px-2 text-dim">
            seed data (not the live database)
          </span>
        )}
      </section>

      <aside className="border-l border-line bg-panel p-4 space-y-4 overflow-y-auto">
        {/* TODO(Person B): open-ticket list; clicking a ticket calls onTicketClick(deviceId) */}
        {/* TODO(Person C): <ItemDrawer /> when a position is selected */}
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
        </div>

        {/* Stand-in until B's ticket list lands: one row per highlighted position. */}
        <div>
          <p className="text-dim mb-1">Problems on the floor</p>
          <ul className="space-y-1">
            {floor?.highlights.map((h) => (
              <li key={`${h.deviceId}/${h.localId}`}>
                <button className={`hover:underline ${SEV_TEXT[h.severity]}`} onClick={() => onTicketClick(h.deviceId)}>
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
