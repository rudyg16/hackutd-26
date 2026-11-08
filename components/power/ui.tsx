"use client";
// OWNER: Person C. Small shared pieces for the /power page.
import type { PowerState } from "@/lib/sim/api-types";

export const STATE_TEXT: Record<PowerState, string> = {
  ok: "text-neon-green",
  warn: "text-neon-amber",
  critical: "text-sev-critical",
};
export const STATE_BAR: Record<PowerState, string> = {
  ok: "bg-neon-green",
  warn: "bg-neon-amber",
  critical: "bg-sev-critical",
};

export const fmtW = (w: number) => (w >= 10_000 ? `${(w / 1000).toFixed(1)} kW` : `${Math.round(w).toLocaleString()} W`);

/** Bar of draw against a limit; the marker sits at the limit (100%) and the bar scales to 125% of it. */
export function LimitBar({ drawW, limitW, state }: { drawW: number; limitW: number; state: PowerState }) {
  const scale = limitW * 1.25;
  const pct = Math.min(100, (drawW / scale) * 100);
  return (
    <div className="relative h-2.5 w-full rounded bg-panel-2">
      <div className={`h-full rounded ${STATE_BAR[state]}`} style={{ width: `${pct}%` }} />
      <div className="absolute top-[-3px] h-4 w-0.5 bg-ink" style={{ left: `${(limitW / scale) * 100}%` }} title="limit" />
    </div>
  );
}

/** Tiny line chart of recent draw. Empty until the page has seen two samples. */
export function Sparkline({ points, state }: { points: number[]; state: PowerState }) {
  if (points.length < 2) return <span className="text-xs text-dim">collecting…</span>;
  const w = 120;
  const h = 28;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${((i / (points.length - 1)) * w).toFixed(1)},${(h - 2 - ((p - min) / span) * (h - 4)).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} className={STATE_TEXT[state]} aria-label="recent draw">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}
