"use client";
// OWNER: Person C. /power — read-only power and thermal view (shift_lead and admin only). See docs/POWER-SPEC.md §6.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTableChanges } from "@/components/board/useTableChanges";
import { FacilityGauge } from "@/components/power/FacilityGauge";
import { RackDrill } from "@/components/power/RackDrill";
import { RackList } from "@/components/power/RackList";
import type { PowerSnapshot } from "@/lib/sim/api-types";
import { fetchPower } from "@/lib/sim/power-client";

const STALE_MS = 5000;
const HISTORY_MS = 10 * 60 * 1000; // sparkline window: what this page has seen in the last 10 minutes
const MIN_GAP_MS = 1500; // Realtime can fire constantly; don't refetch faster than this

export default function PowerPage() {
  const [snap, setSnap] = useState<PowerSnapshot | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, number[]>>({});
  const [now, setNow] = useState(() => Date.now());
  const samples = useRef<Record<string, Array<[number, number]>>>({});
  const lastFetch = useRef(0);
  const selectedRef = useRef<string | null>(null);

  const load = useCallback((force = false) => {
    const t = Date.now();
    if (!force && t - lastFetch.current < MIN_GAP_MS) return;
    lastFetch.current = t;
    fetchPower(selectedRef.current)
      .then((s) => {
        setSnap(s);
        setError("");
        for (const r of s.racks) {
          const arr = (samples.current[r.rackId] ??= []);
          arr.push([t, r.drawW]);
          while (arr.length && t - arr[0][0] > HISTORY_MS) arr.shift();
        }
        setHistory(Object.fromEntries(Object.entries(samples.current).map(([k, v]) => [k, v.map(([, w]) => w)])));
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    load(true);
    const poll = setInterval(() => load(), 2000); // fallback when Realtime isn't configured
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [load]);
  useTableChanges("position_metrics", () => load());

  const select = (rackId: string | null) => {
    selectedRef.current = rackId;
    setSelected(rackId);
    load(true);
  };

  const heartbeatAge = snap?.heartbeatAt ? now - Date.parse(snap.heartbeatAt) : null;
  const stale = snap !== null && (heartbeatAge === null || heartbeatAge > STALE_MS);
  const selectedRack = snap?.racks.find((r) => r.rackId === selected) ?? null;

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <h1 className="text-xl text-neon-cyan neon-text">Power &amp; thermal</h1>
      {error === "forbidden" ? (
        <p className="text-dim">The power view is for shift leads and admins. Switch account to continue.</p>
      ) : error && !snap ? (
        <p className="text-sev-critical">{error}</p>
      ) : !snap ? (
        <p className="text-dim">Loading…</p>
      ) : (
        <>
          {stale && (
            <p className="rounded border border-neon-amber px-3 py-2 text-sm text-neon-amber">
              Simulator offline — showing the last known values{heartbeatAge !== null ? ` (${Math.round(heartbeatAge / 1000)} s old)` : ""}.
            </p>
          )}
          <FacilityGauge facility={snap.facility} />
          <RackList racks={snap.racks} history={history} selectedId={selected} onSelect={(id) => select(selected === id ? null : id)} />
          {selectedRack && <RackDrill rack={selectedRack} onClose={() => select(null)} />}
        </>
      )}
    </main>
  );
}
