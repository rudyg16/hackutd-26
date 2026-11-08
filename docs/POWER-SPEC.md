# NMC² Ops — Power & Thermal Model Spec

**Owner:** Person C (extends the simulator in `SIM-SPEC.md`).

**Goal:** a read-only **/power** tab where operators see how much power every component, device and rack draws, how close the facility is to its capacity, and how a hardware fault (a dying fan) makes a rack run hotter and draw more. Same hidden-state, seeded, replayable model as the rest of the simulator. No new process, no new tables.

---

## 1. Scope

**In v1**
- A pure power/thermal engine module, run inside the existing sim tick.
- Per-component draw, summed per device, rolled up per rack and facility.
- A thermal feedback loop (heat → fan speed and leakage → watts → heat).
- A 2D `/power` page: facility headroom gauge, rack list, drill-down, sparklines.
- A pinned `demo-heat` scenario and a deterministic dry-run check.

**Out of v1**
- Control actions (capping, load shedding, tickets from the tab).
- A `power` alert category (it would touch `shared/types.ts` and the AI prompts, which are Person B's).
- DB-stored history.
- Tenant-scoped views.
- 3D rack tinting (stretch goal, the 3D floor is Person A's).

## 2. Access

- `/power` and `app/api/power/**` require role `shift_lead` or `admin`, checked with `getCurrentUser` the way `app/api/sim/**` does it (`lib/sim/route-auth.ts`).
- Operators see **all** racks, each labelled with its owning tenant. There is no tenant filtering.

## 3. Engine (`lib/sim/engine/power.ts`)

Pure TypeScript, no I/O, no `Math.random` (use the engine's seeded RNG). It runs once per tick after the existing metrics step. Same seed, scenario, config and command sequence must give identical output under `--dry-run`.

### 3.1 Component draw

Idle and max watts per component are keyed by position kind (and device kind where it differs). They live in `lib/sim/config.ts` or a new `lib/sim/power-config.ts`, **not** in `seed/device-models.json` (Person A's file).

```ts
type PartPower = { idleW: number; maxW: number };
// powerByKind: Partial<Record<PositionKind, PartPower>>
// e.g. cpu, dimm_slot, drive_bay, fan_bay, port/uplink (NIC/ASIC), psu_bay (loss only)
```

Component draw = `idleW + (maxW - idleW) * utilisation`, then the thermal terms in §3.3.

**Device draw** = sum of its components. The PSU `watts` reading already in `position_metrics` becomes the device draw divided across installed, non-`lost` PSUs (replacing the fixed `nominalWatts` jitter). A device with every PSU `lost` draws 0.

### 3.2 Utilisation

- Servers: a seeded slow random walk per device, clamped to 30–70%.
- Switches: near-constant (about 50% ± 3%).
- The walk state is held in engine memory only.

### 3.3 Thermal loop

Per device, each tick:

1. **Heat in** = device draw (W).
2. **Cooling** depends on fan health. Each working fan contributes cooling proportional to its RPM. A failed fan (`rpm = 0`) contributes none, and the surviving fans spin up (RPM target rises with temperature, capped at max).
3. **Temperature** moves toward its steady state with a first-order lag, **time constant about 8 sim-minutes**, so a fan failure ramps visibly within about 30 real seconds at the default speed. Baseline noise from SIM-SPEC §6 still applies. The result is clamped to a ceiling so the loop always reaches a stable steady state.
4. **Fan power** scales with the cube of RPM.
5. **Leakage:** above about 45 °C, add roughly 0.5–1% to the silicon draw per °C.
6. Draw feeds back into heat on the next tick.

This is a plausible curve, not CFD. Required properties:
- A healthy device sits at its normal baseline (38–45 °C) and does not drift.
- Losing one fan raises that device's temperature and draw by a visible amount.
- It cannot diverge: the clamps give a bounded steady state.

Existing detection rules are unchanged. The fan rule (`rpm < 40%` or device temp > 75 °C) still fires from the same `tempC` the thermal loop now produces.

### 3.4 Metrics written

No new tables. Fields are added to the existing `position_metrics.metrics` shapes:

| Position kind | Added field |
|---|---|
| any component position | `watts: number` (its modeled draw) |
| `fan-1` position (device row) | `tempC` stays here, as today |
| `psu_bay` | `watts` becomes the share of device draw (not fixed jitter) |

Changed rows are flushed by the existing batched upsert (`flushMs`). `lib/sim/engine/types.ts` and `lib/sim/thresholds.ts` are updated for the new field.

## 4. Capacity

| Level | Limit | Source |
|---|---|---|
| Rack | 130% of the rack's healthy typical draw | computed at startup from the healthy model at 50% utilisation |
| Facility | 85% of the sum of the rack limits | computed from the rack limits |

Both are overridable in config. State thresholds on `draw / limit`:

| State | Condition | Colour token |
|---|---|---|
| ok | below 80% | `text-neon-green` |
| warn | 80% up to 95% | `text-neon-amber` |
| critical | 95% or above | `text-sev-critical` |

The facility limit is below the sum of the rack limits on purpose. One hot rack won't trip the facility, but several overheating racks will.

## 5. API

All routes: `getCurrentUser`, require `shift_lead` or `admin`.

- `GET /api/power` → rollup computed on read from `position_metrics`, devices, racks and orgs:

```ts
type PowerSnapshot = {
  facility: { drawW: number; limitW: number; state: "ok"|"warn"|"critical" };
  racks: {
    rackId: string; tenantId: string; tenantName: string;
    drawW: number; limitW: number; maxTempC: number; state: "ok"|"warn"|"critical";
    devices: { deviceId: string; kind: string; drawW: number; tempC: number;
               components: { positionId: string; kind: string; watts: number }[] }[];
  }[];
  simTimeS: number;
};
```

- The rack limit values come from the engine's config (a pure function of the seeded hardware), so the route does not need the simulator to be running to compute them.
- The page subscribes to Realtime on `position_metrics` and refetches or patches. It reuses the existing channel pattern from `components/ai/LiveMetrics.tsx`.
- Types for this snapshot go in `lib/sim/api-types.ts` (mine), not `shared/api.ts` (Person B's).

## 6. `/power` page

Files: `app/power/**`, `app/api/power/**`, `components/power/**`. The neon theme tokens from `app/globals.css` are used, and nothing there is edited.

Layout, top to bottom:

1. **Facility headroom gauge:** draw / limit, colour by state, with the number in W (or kW).
2. **Rack list**, sorted by draw (highest first). Each row shows the rack ID, a tenant label, a bar with a limit marker, draw, max device temperature and state colour.
3. **Drill-down:** click a rack → its devices (draw, temp) → a device's components (watts each). Same rack → device → position pattern as `components/sim/BreakPicker.tsx`.
4. **Sparkline per rack:** an in-browser ring buffer of about 5–10 minutes, built from the Realtime stream while the page is open. It is empty on first load and fills as you watch. There is no DB history.
5. A stale banner when the simulator heartbeat (`sim_control.heartbeat_at`) is older than 5 s, as `/sim` does.

## 7. Nav

One link, "Power", to `/power` in `app/layout.tsx` next to the Sim link. **That file is Person B's.** Either B adds the line, or the user adds it themselves, as in the last commit that added the Sim link.

## 8. Scenario

`lib/sim/scenarios/demo-heat.json` pins a fan `bearing_wear` defect on one server so the draw and temperature rise land inside a recording, at a predictable time. Unpinned positions stay random. The Break picker's existing `fan_bay` / `bearing_wear` option works unchanged for live demos. No new break types.

## 9. Config additions (`lib/sim/config.ts`)

```ts
power: {
  powerByKind: { /* idleW / maxW per position kind */ },
  utilisation: { serverMin: 0.3, serverMax: 0.7, switch: 0.5 },
  thermal: { timeConstantSimMin: 8, leakagePerDegC: 0.0075, leakageAboveC: 45, maxTempC: 95 },
  limits: { rackFactor: 1.3, facilityFactor: 0.85, warnAt: 0.8, criticalAt: 0.95 },
}
```

Numbers are starting points, tuned with `--dry-run`.

## 10. Verification

A deterministic dry-run check (extend `lib/sim/dryrun.ts` or add a script) asserts:

1. The same seed and scenario give identical power output across two runs (`diff`).
2. With no defects, every rack stays under 80% of its limit and temperatures stay at baseline.
3. After a fan failure, that rack's draw and its device temperature rise by a visible margin and settle to a bounded value.
4. With every PSU of a device `lost`, its draw is 0.

The UI is checked by eye in the browser against a live `npm run sim -- --scenario demo-heat`.

## 11. Ownership

| Change | File | Owner |
|---|---|---|
| Engine, config, types, thresholds, scenario | `lib/sim/**` | C |
| Page, route, components | `app/power/**`, `app/api/power/**`, `components/power/**` | C |
| Nav link | `app/layout.tsx` | **B** (request needed) |
| No migration, no `shared/**` change, no `seed/device-models.json` change | — | — |

## 12. Stretch

- Tint racks on the 3D floor by power state (Person A).
- DB-stored history for trends across page loads.
- A `power` alert category through the ticket pipeline (needs Person B for `shared/types.ts`).
