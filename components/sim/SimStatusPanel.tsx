"use client";
// OWNER: Person C. Simulator status, pause/resume and speed (SIM-SPEC §12).
import { useEffect, useState } from "react";
import type { SimStatus } from "@/lib/sim/api-types";
import { simApi } from "@/lib/sim/client";

const STALE_MS = 5000;
const btn = "rounded border px-3 py-1.5 text-sm disabled:opacity-40";

export const simClock = (s: number) => {
  const t = Math.floor(s);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
};

export function SimStatusPanel({ status, onChange }: { status: SimStatus; onChange: () => void }) {
  const control = status.control;
  const [speed, setSpeed] = useState(control?.speed ?? 60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Follow the server unless the user is mid-drag.
  useEffect(() => { if (control) setSpeed(control.speed); }, [control?.speed]); // eslint-disable-line react-hooks/exhaustive-deps

  const heartbeatAge = control?.heartbeatAt ? now - Date.parse(control.heartbeatAt) : null;
  const alive = heartbeatAge !== null && heartbeatAge < STALE_MS;
  const state = !control ? "not started" : !alive ? "stale" : control.paused ? "paused" : "running";
  const stateStyle = { running: "text-neon-green", paused: "text-neon-amber", stale: "text-sev-critical", "not started": "text-dim" }[state];

  async function patch(p: { paused?: boolean; speed?: number }) {
    setBusy(true);
    setError("");
    try {
      await simApi.setControl(p);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className={`text-sm font-semibold uppercase tracking-wider ${stateStyle}`}>● {state}</span>
        {control && (
          <>
            <span className="text-sm text-dim">Sim clock <span className="font-mono text-ink">{simClock(control.simTimeS)}</span></span>
            <span className="text-sm text-dim">Seed <span className="font-mono text-ink">{control.seed ?? "—"}</span></span>
            <span className="text-sm text-dim">Scenario <span className="text-ink">{control.scenario ?? "none"}</span></span>
          </>
        )}
        <span className="text-sm text-dim">Alerts <span className="text-ink">{status.alertCount}</span></span>
        <span className="text-sm text-dim">Sim tickets <span className="text-ink">{status.simTicketCount}</span></span>
      </div>

      {!control ? (
        <p className="mt-3 text-sm text-dim">Start the simulator with <code className="text-neon-cyan">npx tsx scripts/sim.ts</code> to enable controls.</p>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <button
            disabled={busy}
            onClick={() => patch({ paused: !control.paused })}
            className={`${btn} ${control.paused ? "border-neon-green text-neon-green" : "border-neon-amber text-neon-amber"}`}
          >
            {control.paused ? "Resume" : "Pause"}
          </button>
          <label className="flex items-center gap-3 text-sm text-dim">
            Speed
            <input
              type="range" min={10} max={600} step={10} value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              onMouseUp={() => patch({ speed })}
              onTouchEnd={() => patch({ speed })}
              onKeyUp={() => patch({ speed })}
              className="w-56 accent-cyan-400"
            />
            <span className="w-24 font-mono text-ink">{speed}× ({(speed / 60).toFixed(1)} min/s)</span>
          </label>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-sev-critical">{error}</p>}
    </section>
  );
}
