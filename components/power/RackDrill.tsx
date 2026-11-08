"use client";
// OWNER: Person C. Drill-down: rack → its devices (draw, temp) → a device's components (watts each).
import { useMemo, useState } from "react";
import type { PowerRack } from "@/lib/sim/api-types";
import { STATE_TEXT, fmtW } from "./ui";

const KIND_LABEL: Record<string, string> = {
  port: "Ports", uplink: "Uplinks", dimm_slot: "Memory", drive_bay: "Drives", fan_bay: "Fans", psu_bay: "PSUs (wall draw share)",
};

export function RackDrill({ rack, onClose }: { rack: PowerRack; onClose: () => void }) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const device = rack.devices.find((d) => d.deviceId === deviceId) ?? null;
  const devices = useMemo(() => [...rack.devices].sort((a, b) => b.drawW - a.drawW), [rack.devices]);

  const groups = useMemo(() => {
    const g = new Map<string, { count: number; watts: number; items: { positionId: string; watts: number }[] }>();
    for (const c of device?.components ?? []) {
      const e = g.get(c.kind) ?? { count: 0, watts: 0, items: [] };
      e.count++;
      e.watts += c.watts;
      e.items.push({ positionId: c.positionId, watts: c.watts });
      g.set(c.kind, e);
    }
    return [...g.entries()];
  }, [device]);

  return (
    <section className="rounded border border-line bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm uppercase tracking-wider text-neon-magenta">
          Rack {rack.rackId.replace("rack-", "")} · {rack.tenantName}
          {device && <span className="text-ink"> › {device.deviceId}</span>}
        </h2>
        <div className="flex gap-3 text-sm">
          {device && <button className="text-dim hover:text-ink" onClick={() => setDeviceId(null)}>← devices</button>}
          <button className="text-dim hover:text-ink" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>

      {!device ? (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-dim"><tr><th className="pb-1">Device</th><th>Kind</th><th className="text-right">Draw</th><th className="text-right">Temp</th></tr></thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.deviceId} onClick={() => setDeviceId(d.deviceId)} className="cursor-pointer border-t border-line hover:bg-panel-2">
                <td className="py-1 font-mono text-xs text-ink">{d.deviceId}</td>
                <td className="text-dim">{d.kind}</td>
                <td className={`text-right font-mono ${d.drawW === 0 ? "text-sev-critical" : "text-ink"}`}>{fmtW(d.drawW)}</td>
                <td className={`text-right font-mono ${d.tempC > 75 ? "text-sev-critical" : d.tempC > 55 ? "text-neon-amber" : "text-dim"}`}>{d.tempC.toFixed(0)} °C</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : groups.length === 0 ? (
        <p className="text-sm text-dim">Loading components…</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            <span className={STATE_TEXT.ok}>{fmtW(device.drawW)}</span> wall draw · {device.tempC.toFixed(1)} °C
          </p>
          {groups.map(([kind, g]) => (
            <details key={kind} className="rounded border border-line p-2">
              <summary className="cursor-pointer text-sm text-ink">
                {KIND_LABEL[kind] ?? kind} <span className="text-dim">× {g.count}</span>
                <span className="float-right font-mono text-dim">{fmtW(g.watts)}</span>
              </summary>
              <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs sm:grid-cols-3">
                {g.items.sort((a, b) => b.watts - a.watts).map((i) => (
                  <li key={i.positionId} className="flex justify-between"><span className="text-dim">{i.positionId.split("/")[1]}</span><span className="font-mono text-ink">{i.watts.toFixed(1)} W</span></li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
