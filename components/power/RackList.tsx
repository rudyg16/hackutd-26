"use client";
// OWNER: Person C. Racks sorted by draw, with a limit marker, max temperature and a sparkline.
import type { PowerRack } from "@/lib/sim/api-types";
import { LimitBar, Sparkline, STATE_TEXT, fmtW } from "./ui";

export function RackList({
  racks, history, selectedId, onSelect,
}: {
  racks: PowerRack[];
  history: Record<string, number[]>;
  selectedId: string | null;
  onSelect: (rackId: string) => void;
}) {
  return (
    <section className="rounded border border-line bg-panel p-4">
      <h2 className="mb-3 text-sm uppercase tracking-wider text-neon-cyan">Racks by draw</h2>
      <ul className="space-y-2">
        {racks.map((r) => (
          <li key={r.rackId}>
            <button
              onClick={() => onSelect(r.rackId)}
              className={`grid w-full grid-cols-[5.5rem_1fr_auto] items-center gap-x-4 gap-y-1 rounded border px-3 py-2 text-left text-sm sm:grid-cols-[5.5rem_9rem_1fr_7rem_5rem_7.5rem] ${
                selectedId === r.rackId ? "border-neon-cyan bg-panel-2" : "border-line hover:border-dim"
              }`}
            >
              <span className="font-mono text-ink">{r.rackId.replace("rack-", "")}</span>
              <span className="hidden truncate text-xs text-dim sm:block">{r.tenantName}</span>
              <LimitBar drawW={r.drawW} limitW={r.limitW} state={r.state} />
              <span className={`text-right font-mono ${STATE_TEXT[r.state]}`}>{fmtW(r.drawW)}</span>
              <span className={`hidden text-right font-mono sm:block ${r.maxTempC > 75 ? "text-sev-critical" : r.maxTempC > 55 ? "text-neon-amber" : "text-dim"}`}>
                {r.maxTempC.toFixed(0)} °C
              </span>
              <span className="hidden sm:block">
                <Sparkline points={history[r.rackId] ?? []} state={r.state} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
