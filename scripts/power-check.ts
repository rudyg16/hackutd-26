/**
 * Deterministic power/thermal checks (docs/POWER-SPEC.md §10). Run: npx tsx scripts/power-check.ts
 * Exits non-zero if any check fails.
 */
import base from "../seed/base.json";
import { createState, inventoryFromSeed, tick, type SeedLike, type SimState } from "../lib/sim/engine";
import { applyPower, powerLimits } from "../lib/sim/engine/power";
import { Rng } from "../lib/sim/engine/rng";
import { loadScenario, resolvePins } from "../lib/sim/scenarios";
import { SIM_CONFIG } from "../lib/sim/config";

const inv = inventoryFromSeed(base as unknown as SeedLike);
const QUIET = { minDefectsPerTenant: 0, doaChance: 0, defectChance: { cable: 0, sfp: 0, drive: 0, fan: 0, dimm: 0, psu: 0, port: 0 } };
const limits = powerLimits(Object.values(inv.devices), SIM_CONFIG.power);
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  if (!ok) failed++;
};

const psuIds = new Map<string, string[]>();
for (const p of Object.values(inv.positions)) if (p.kind === "psu_bay") psuIds.set(p.deviceId, [...(psuIds.get(p.deviceId) ?? []), p.id]);
const devicesByRack = new Map<string, string[]>();
for (const d of Object.values(inv.devices)) devicesByRack.set(d.rackId, [...(devicesByRack.get(d.rackId) ?? []), d.id]);
const draw = (s: SimState, deviceId: string) =>
  (psuIds.get(deviceId) ?? []).reduce((a, id) => a + ((s.metrics[id] as { watts?: number }).watts ?? 0), 0);
const rackDraw = (s: SimState, rackId: string) => (devicesByRack.get(rackId) ?? []).reduce((a, id) => a + draw(s, id), 0);
const temp = (s: SimState, id: string) => (s.metrics[`${id}/fan-1`] as { tempC: number }).tempC;

// 1. Determinism: same seed + scenario ⇒ identical power output.
function fingerprint() {
  const scenario = loadScenario("demo-heat");
  let s = createState(inv, { seed: 7, config: scenario.config, pins: resolvePins(scenario, 7, 60) });
  const out: string[] = [];
  for (let i = 0; i < 240; i++) {
    s = tick(s, [], [], 60).state;
    if (i % 10 === 0) out.push(`${Math.round(rackDraw(s, "rack-C4"))}/${temp(s, "SRV-C4-03")}`);
  }
  return out.join(",");
}
check("1 determinism", fingerprint() === fingerprint(), "two runs of demo-heat seed 7 gave identical rack draw and temperatures");

// 2. No defects: racks stay under 80% of limit; temperatures stay at baseline.
{
  let s = createState(inv, { seed: 3, config: QUIET });
  let worst = 0;
  let devOff = 0;
  for (let i = 0; i < 480; i++) {
    s = tick(s, [], [], 60).state;
    for (const [rackId, lim] of Object.entries(limits.racksW)) worst = Math.max(worst, rackDraw(s, rackId) / lim);
    if (i % 10 === 0) {
      for (const d of Object.values(s.inventory.devices)) {
        if (d.kind !== "server" && d.kind !== "switch") continue;
        devOff = Math.max(devOff, Math.abs(temp(s, d.id) - s.thermal[d.id].baseTempC));
      }
    }
  }
  check("2 healthy baseline", worst < 0.8 && devOff < 6, `worst rack ${(worst * 100).toFixed(1)}% of limit (<80%); max |temp - baseline| ${devOff.toFixed(1)} °C (<6 incl. ±3 noise)`);
}

// 3. Fan failure: device temp and draw rise, rack draw rises, and it settles to a bounded value.
{
  const cfg = { ...QUIET, power: { utilisation: { stepSd: 0 } } }; // freeze utilisation so the comparison is paired
  const run = (fans: Array<[string, number]>) => {
    let s = createState(inv, { seed: 1, config: cfg });
    const cmds = fans.flatMap(([dev, n]) => Array.from({ length: n }, (_, i) => ({ kind: "break" as const, positionId: `${dev}/fan-${i + 2}`, failureMode: "bearing_wear" as const })));
    s = tick(s, cmds, [], 60).state;
    const t: number[] = [], w: number[] = [], r: number[] = [];
    for (let i = 0; i < 480; i++) {
      s = tick(s, [], [], 60).state;
      if (i >= 420) { t.push(temp(s, "SRV-C4-03")); w.push(draw(s, "SRV-C4-03")); r.push(rackDraw(s, "rack-C4")); }
    }
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    return { t: avg(t), w: avg(w), r: avg(r), maxT: Math.max(...t), spread: Math.max(...t) - Math.min(...t) };
  };
  const healthy = run([]);
  const one = run([["SRV-C4-03", 1]]);
  const hot = run([["SRV-C4-03", 3], ["SRV-C4-04", 3], ["SRV-C4-05", 3], ["SRV-C4-06", 3]]);
  check("3a one fan fails", one.t - healthy.t > 5 && one.w / healthy.w > 1.02, `device +${(one.t - healthy.t).toFixed(1)} °C, +${((one.w / healthy.w - 1) * 100).toFixed(1)}% draw`);
  check("3b four servers lose fans", hot.r / healthy.r > 1.08, `rack C4 draw +${((hot.r / healthy.r - 1) * 100).toFixed(1)}%`);
  check("3c bounded", hot.maxT <= SIM_CONFIG.power.thermal.maxTempC + 4 && hot.spread < 8, `max ${hot.maxT.toFixed(1)} °C (ceiling ${SIM_CONFIG.power.thermal.maxTempC} + noise), settled spread ${hot.spread.toFixed(1)} °C`);
}

// 4. Every PSU of a device lost ⇒ its draw is 0.
{
  const s = createState(inv, { seed: 1, config: QUIET });
  const id = "SRV-C4-03";
  const metrics = { ...s.metrics };
  for (const p of Object.values(s.inventory.positions).filter((p) => p.deviceId === id && p.kind === "psu_bay")) {
    metrics[p.id] = { psuInput: "lost", watts: 0 };
  }
  const r = applyPower({ inventory: s.inventory, metrics, thermal: s.thermal, power: s.power, dtS: 60, rng: new Rng(1), config: s.config });
  const lost = Object.values(s.inventory.positions).filter((p) => p.deviceId === id && p.kind === "psu_bay").reduce((a, p) => a + ((r.metrics[p.id] as { watts: number }).watts), 0);
  check("4 all PSUs lost", lost === 0, `device draw ${lost} W`);
}

console.log(failed === 0 ? "\nAll power checks passed." : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
