"use client";
// OWNER: Person C. /sim — simulator status, controls, "break something", live alerts (shift_lead and admin only).
import { useCallback, useEffect, useState } from "react";
import { useTableChanges } from "@/components/board/useTableChanges";
import { AlertsFeed } from "@/components/sim/AlertsFeed";
import { BreakPicker } from "@/components/sim/BreakPicker";
import { SimStatusPanel } from "@/components/sim/SimStatusPanel";
import { XrayPanel } from "@/components/sim/XrayPanel";
import type { SimStatus } from "@/lib/sim/api-types";
import { simApi } from "@/lib/sim/client";

export default function SimPage() {
  const [status, setStatus] = useState<SimStatus | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    simApi.status().then((s) => { setStatus(s); setError(""); }).catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 2000); // heartbeat freshness needs steady refreshes even without Realtime
    return () => clearInterval(poll);
  }, [load]);
  useTableChanges("sim_control", load);

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-xl text-neon-cyan neon-text">Hardware simulator</h1>
      {error === "forbidden" ? (
        <p className="text-dim">The simulator console is for shift leads and admins. Switch account to continue.</p>
      ) : error ? (
        <p className="text-sev-critical">{error}</p>
      ) : !status ? (
        <p className="text-dim">Loading…</p>
      ) : (
        <>
          <SimStatusPanel status={status} onChange={load} />
          <BreakPicker />
          <AlertsFeed />
          <XrayPanel simTimeS={status.control?.simTimeS ?? 0} />
        </>
      )}
    </main>
  );
}
