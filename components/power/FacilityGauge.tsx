"use client";
// OWNER: Person C. Facility headroom gauge: draw / limit, coloured by state.
import type { PowerSnapshot } from "@/lib/sim/api-types";
import { LimitBar, STATE_TEXT, fmtW } from "./ui";

export function FacilityGauge({ facility }: { facility: PowerSnapshot["facility"] }) {
  const ratio = facility.limitW > 0 ? facility.drawW / facility.limitW : 0;
  return (
    <section className="rounded border border-line bg-panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm uppercase tracking-wider text-neon-cyan">Facility headroom</h2>
        <span className={`text-sm font-semibold uppercase ${STATE_TEXT[facility.state]}`}>{facility.state}</span>
      </div>
      <p className="mt-2">
        <span className={`text-3xl font-semibold ${STATE_TEXT[facility.state]}`}>{(ratio * 100).toFixed(0)}%</span>
        <span className="ml-3 text-sm text-dim">
          {fmtW(facility.drawW)} of {fmtW(facility.limitW)} · {fmtW(Math.max(0, facility.limitW - facility.drawW))} headroom
        </span>
      </p>
      <div className="mt-3">
        <LimitBar drawW={facility.drawW} limitW={facility.limitW} state={facility.state} />
      </div>
    </section>
  );
}
