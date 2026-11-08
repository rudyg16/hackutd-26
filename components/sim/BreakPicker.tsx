"use client";
// OWNER: Person C. "Break something": rack → device → position → failure mode (SIM-SPEC §12).
// Racks and devices come from /api/floor, so users only see what they're allowed to.
import { useEffect, useMemo, useState } from "react";
import { api } from "@/shared/api";
import type { FloorView, PositionKind } from "@/shared/types";
import models from "@/seed/device-models.json";
import { simApi } from "@/lib/sim/client";
import { MODE_LABELS, modesForPosition } from "@/lib/sim/valid-modes";
import type { FailureMode } from "@/lib/sim/engine/types";

type Group = { kind: string; prefix: string; count: number };
type Model = { faces: Record<string, Group[]> };

function positionsOf(modelId: string, deviceId: string) {
  const model = (models.models as Record<string, Model>)[modelId];
  if (!model) return [];
  return Object.values(model.faces).flat().flatMap((g) =>
    Array.from({ length: g.count }, (_, i) => ({
      id: `${deviceId}/${g.prefix}-${i + 1}`,
      localId: `${g.prefix}-${i + 1}`,
      kind: g.kind as PositionKind,
    })),
  );
}

const field = "rounded border border-line bg-panel-2 px-2 py-1.5 text-sm text-ink outline-none focus:border-neon-cyan disabled:opacity-40";

export function BreakPicker() {
  const [floor, setFloor] = useState<FloorView | null>(null);
  const [rackId, setRackId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [positionId, setPositionId] = useState("");
  const [mode, setMode] = useState<FailureMode | "">("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { api.floor().then(setFloor).catch((e) => setMessage({ ok: false, text: String(e.message ?? e) })); }, []);

  const racks = floor?.racks.filter((r) => r.visible) ?? [];
  const devices = floor?.devices.filter((d) => d.rackId === rackId) ?? [];
  const device = devices.find((d) => d.id === deviceId);
  const positions = useMemo(() => (device ? positionsOf(device.modelId, device.id) : []), [device]);
  const position = positions.find((p) => p.id === positionId);
  const modes = position ? modesForPosition(position.kind, position.localId) : [];

  async function submit() {
    if (!positionId || !mode) return;
    setBusy(true);
    setMessage(null);
    try {
      await simApi.breakPosition({ positionId, failureMode: mode });
      setMessage({ ok: true, text: `Sent: ${MODE_LABELS[mode]} on ${positionId}. The simulator applies it on its next tick.` });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded border border-line bg-panel p-4">
      <h2 className="mb-3 text-sm uppercase tracking-wider text-neon-magenta">Break something</h2>
      <div className="flex flex-wrap items-center gap-3">
        <select className={field} value={rackId} onChange={(e) => { setRackId(e.target.value); setDeviceId(""); setPositionId(""); setMode(""); }}>
          <option value="">Rack…</option>
          {racks.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <select className={field} value={deviceId} disabled={!rackId} onChange={(e) => { setDeviceId(e.target.value); setPositionId(""); setMode(""); }}>
          <option value="">Device…</option>
          {devices.map((d) => <option key={d.id} value={d.id}>{d.id}</option>)}
        </select>
        <select className={field} value={positionId} disabled={!deviceId} onChange={(e) => { setPositionId(e.target.value); setMode(""); }}>
          <option value="">Position…</option>
          {positions.map((p) => <option key={p.id} value={p.id}>{p.localId}</option>)}
        </select>
        <select className={field} value={mode} disabled={!positionId} onChange={(e) => setMode(e.target.value as FailureMode)}>
          <option value="">Failure…</option>
          {modes.map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
        </select>
        <button
          disabled={!mode || busy}
          onClick={submit}
          className="rounded border border-neon-magenta px-3 py-1.5 text-sm text-neon-magenta disabled:opacity-40"
        >
          {busy ? "Sending…" : "Break it"}
        </button>
      </div>
      {message && <p className={`mt-3 text-sm ${message.ok ? "text-neon-green" : "text-sev-critical"}`}>{message.text}</p>}
    </section>
  );
}
