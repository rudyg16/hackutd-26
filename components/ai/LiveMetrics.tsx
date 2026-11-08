"use client";
// OWNER: Person C. "Live" section of the ItemDrawer: simulator metrics for one position (SIM-SPEC §13).
// Realtime is only a nudge; values are re-read through the access-checked API.
import { useCallback, useEffect, useState } from "react";
import { useTableChanges } from "@/components/board/useTableChanges";
import type { PositionMetricsRow } from "@/lib/sim/api-types";
import { simApi } from "@/lib/sim/client";
import { readMetrics } from "@/lib/sim/thresholds";

const STALE_MS = 15_000;

export function LiveMetrics({ positionId }: { positionId: string }) {
  const [row, setRow] = useState<PositionMetricsRow | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    simApi.metrics(positionId).then((r) => { setRow(r); setError(""); }).catch((e) => setError(String(e.message ?? e)));
  }, [positionId]);

  useEffect(() => {
    setRow(null);
    load();
    // Polling fallback for when Realtime isn't configured; also keeps the "x s ago" label fresh.
    const poll = setInterval(load, 4000);
    const tickClock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(tickClock); };
  }, [load]);

  useTableChanges("position_metrics", load, `position_id=eq.${positionId}`);

  const age = row?.updatedAt ? now - Date.parse(row.updatedAt) : null;
  const stale = age !== null && age > STALE_MS;
  const readings = row?.metrics ? readMetrics(row.metrics) : [];

  return (
    <section className="rounded border border-line bg-panel-2 p-3">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wider text-dim">Live</h3>
        {age !== null && (
          <span className={`text-xs ${stale ? "text-neon-amber" : "text-neon-green"}`}>
            {stale ? `offline · ${Math.round(age / 1000)}s ago` : "● live"}
          </span>
        )}
      </div>
      {error ? (
        <p className="text-dim">Live data unavailable.</p>
      ) : !row ? (
        <p className="text-dim">Loading…</p>
      ) : readings.length === 0 ? (
        <p className="text-dim">No live data yet — the simulator hasn&apos;t reported for this position.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
          {readings.map((r) => (
            <div key={r.label} className="contents">
              <dt className="text-xs text-dim">{r.label}</dt>
              <dd className={`text-right font-mono text-xs ${r.bad ? "font-bold text-sev-critical" : r.warn ? "text-neon-amber" : "text-ink"}`}>
                {r.value}
                {r.bad && " ⚠"}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
