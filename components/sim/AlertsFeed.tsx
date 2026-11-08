"use client";
// OWNER: Person C. Last 20 simulator alerts, each linked to its ticket (SIM-SPEC §12).
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTableChanges } from "@/components/board/useTableChanges";
import type { Severity } from "@/shared/types";
import type { SimAlertRow } from "@/lib/sim/api-types";
import { simApi } from "@/lib/sim/client";

const SEV_TEXT: Record<Severity, string> = {
  low: "text-sev-low", medium: "text-sev-medium", high: "text-sev-high", critical: "text-sev-critical",
};

export function AlertsFeed() {
  const [alerts, setAlerts] = useState<SimAlertRow[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    simApi.alerts(20).then((a) => { setAlerts(a); setError(""); }).catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 5000); // fallback when Realtime isn't configured
    return () => clearInterval(poll);
  }, [load]);
  useTableChanges("alerts", load);

  return (
    <section className="rounded border border-line bg-panel p-4">
      <h2 className="mb-3 text-sm uppercase tracking-wider text-neon-cyan">Recent alerts</h2>
      {error && <p className="text-sm text-sev-critical">{error}</p>}
      {!alerts && !error && <p className="text-sm text-dim">Loading…</p>}
      {alerts && alerts.length === 0 && <p className="text-sm text-dim">No alerts yet.</p>}
      <ul className="space-y-2">
        {alerts?.map((a) => (
          <li key={a.id} className={`rounded border border-line p-2 text-sm ${a.clearedAt ? "opacity-50" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <span className={`text-xs font-semibold uppercase ${SEV_TEXT[a.severity]}`}>{a.severity}</span>
              <span className="text-xs text-dim">{new Date(a.createdAt).toLocaleTimeString()}{a.clearedAt ? " · cleared" : ""}</span>
            </div>
            <p className="mt-1 text-ink">{a.message}</p>
            <p className="mt-1 text-xs text-dim">
              {a.category} ·{" "}
              {a.ticketId ? (
                <Link href="/board" className="text-neon-cyan hover:underline">ticket {a.ticketId.slice(0, 8)}</Link>
              ) : (
                "no ticket yet"
              )}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
