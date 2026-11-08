"use client";
// OWNER: Person C. Admin-only X-ray: the simulator's hidden defects, so after a repair you can show
// that the technician's diagnosis and the AI's recommendation matched the real cause (SIM-SPEC §17).
import { useCallback, useEffect, useState } from "react";
import type { XrayRow } from "@/lib/sim/api-types";
import { simApi } from "@/lib/sim/client";
import { MODE_LABELS } from "@/lib/sim/valid-modes";
import { simClock } from "./SimStatusPanel";

function phase(r: XrayRow, nowS: number) {
  if (r.suppressedUntilSimS !== null && nowS < r.suppressedUntilSimS) {
    return { text: `suppressed until ${simClock(r.suppressedUntilSimS)}`, style: "text-neon-amber" };
  }
  if (nowS < r.onsetSimS) return { text: `starts in ${simClock(r.onsetSimS - nowS)}`, style: "text-dim" };
  return { text: "active", style: "text-sev-critical" };
}

export function XrayPanel({ simTimeS }: { simTimeS: number }) {
  const [access, setAccess] = useState<"unknown" | "allowed" | "denied">("unknown");
  const [on, setOn] = useState(false);
  const [rows, setRows] = useState<XrayRow[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    simApi.xray()
      .then((r) => { setRows(r); setAccess("allowed"); setError(""); })
      .catch((e) => {
        if (String(e.message) === "forbidden") setAccess("denied");
        else { setAccess("allowed"); setError(String(e.message ?? e)); }
      });
  }, []);

  useEffect(() => { load(); }, [load]); // probe once so non-admins never see the toggle
  useEffect(() => {
    if (!on) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [on, load]);

  if (access !== "allowed") return null;

  return (
    <section className="rounded border border-line bg-panel p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm uppercase tracking-wider text-neon-amber">X-ray (hidden state)</h2>
        <button
          onClick={() => setOn((v) => !v)}
          className={`rounded border px-3 py-1 text-sm ${on ? "border-neon-amber text-neon-amber" : "border-line text-dim"}`}
        >
          {on ? "Hide" : "Show"}
        </button>
      </div>
      {on && (
        <>
          {error && <p className="mt-2 text-sm text-sev-critical">{error}</p>}
          {rows.length === 0 ? (
            <p className="mt-3 text-sm text-dim">No hidden defects right now.</p>
          ) : (
            <table className="mt-3 w-full text-left text-sm">
              <thead className="text-xs uppercase text-dim">
                <tr><th className="pb-1">Position</th><th>Cause</th><th>Severity</th><th>Status</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const p = phase(r, simTimeS);
                  return (
                    <tr key={r.id} className="border-t border-line">
                      <td className="py-1 font-mono text-xs text-ink">{r.positionId}</td>
                      <td className="text-ink">{MODE_LABELS[r.defect]}</td>
                      <td className="font-mono text-xs text-dim">{r.severity.toFixed(2)}</td>
                      <td className={`text-xs ${p.style}`}>{p.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
