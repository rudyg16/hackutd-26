# NMC² Ops — Hardware Simulator Spec

**Owner:** Person C. **Overrides** the "live alert simulator" line in `SPEC.md` → Out of scope.

**Goal:** when judges watch, faults come from a seeded random model of the hardware, not from a script. Every run is different. Repairs change what happens next. A judge can break a part they choose, and the system detects it, drafts a ticket, and responds to the fix.

---

## 1. Overview

```
scripts/sim.ts (long-running)            Next.js app                 Browser
┌──────────────────────────────┐        ┌───────────────────┐       ┌───────────────┐
│ lib/sim/engine (pure)        │        │ /api/ai/draft-... │       │ ItemDrawer    │
│  rng · defects · tick ·      │ HTTP   │ /api/tickets      │       │  Live section │
│  detection · repair feedback ├───────►│ (as user-monitor) │       │ /sim controls │
│ lib/sim/adapter (Supabase)   │        └───────────────────┘       │ 3D glow       │
│  read parts/tickets/commands │◄──────── Supabase ─── Realtime ───►│ Board: AI     │
│  write metrics/alerts/state  │                                    │ Drafts column │
└──────────────────────────────┘                                    └───────────────┘
```

- `npm run sim` runs a long-lived Node process (tsx). It keeps running whether or not a browser is open.
- **The engine** (`lib/sim/engine/**`) is pure TypeScript with no I/O. Given the state, the pending commands and a tick, it returns the next state, the changed metrics and new events.
- **The adapter** (`lib/sim/adapter.ts`) does all Supabase reads and writes and the HTTP calls to the app.
- The simulator must not import `lib/ai/*` or `db/client.ts`, which are `server-only`. It creates its own Supabase client from `.env.local`, the way `scripts/seed.ts` does.

## 2. Command line

```
npm run sim                              # sandbox: seed = clock, default speed
npm run sim -- --seed 1234               # replay an exact run
npm run sim -- --scenario demo-port13    # pin scenario conditions (recording)
npm run sim -- --speed 120               # sim-seconds per real second (default 60)
npm run sim -- --dry-run --minutes 10    # print events, no DB writes, runs as fast as possible
npm run sim -- --reset [--seed N]        # wipe run data, redraw defects, exit
```

The seed is printed at startup, so any run can be replayed.

## 3. Time

- The engine ticks once per **real** second and advances simulated time by `speed` seconds. The default speed is 60 (1 simulated minute per real second).
- Fault progression (wear, how long a defect takes to show, how long a reseat holds) runs on **simulated** time.
- Stored timestamps (`alerts.created_at`, metrics `updated_at`, ticket `created_at`) are **real** wall-clock times, so the board and history look normal.
- Speed and pause can be changed live from `/sim` through `sim_control`.

## 4. Randomness

- One seeded random generator (mulberry32 or similar) in `lib/sim/engine/rng.ts`. `Math.random` is never used in the engine.
- The seed comes from the clock by default, or from `--seed N`, or from the scenario's `seed` if it sets one.
- With the same seed, scenario, config and command sequence, `--dry-run` must print identical events. Check this by running it twice and comparing the output with `diff`.

## 5. Hidden state (defect model)

At startup, or for every new part, the engine draws a hidden **condition** for each installed part. This is stored in `sim_part_state` and is **never** sent to the UI, the AI or the tenant views.

```ts
type PartCondition = {
  partId: string;
  positionId: string;
  defect: FailureMode | null;   // null = healthy
  severity: number;             // 0..1, how fast it progresses
  onsetAt: number;              // sim-time (s) when symptoms start
  wear: number;                 // age-based hazard multiplier, from installed_at
  suppressedUntil: number | null; // set by a reseat on a defect that isn't permanently fixed
};
```

Positions can carry a **position-level defect** (a bad switch port) in the same table, with `partId = null`.

**Draw rules** (all in `lib/sim/config.ts`):

| Kind | Defect chance at start | Possible failure modes |
|---|---|---|
| cable | 4% | loose (60%), kinked (40%) |
| sfp | 3% | dirty_optics (70%), failing_laser (30%) |
| drive | 2% | media_wear |
| fan | 2% | bearing_wear |
| dimm | 1% | failing_rows |
| psu | 1% | input_fault |
| port (position) | 0.5% of ports | bad_port |

- **Wear:** `wear = 1 + (ageDays / 365) * wearPerYear[kind]`. It scales the chance that a healthy part develops a defect over time. That chance is small, but it means a long run produces new faults.
- **Guaranteed minimum:** at least `minDefectsPerTenant` (default 3) defective parts per tenant. If the random draw comes up short, extra parts are picked at random until it's met.
- **Onset:** spread uniformly over the first `onsetWindowSimMin` (default 60 simulated minutes), so faults don't all start at once.
- **New part from a replacement:** fresh draw with `doaChance` (default 2%) of a defect that starts immediately.

## 6. Failure catalogue

| Where | Failure mode | Signal (metrics) | Detection rule → alert | Fixed by | Category |
|---|---|---|---|---|---|
| cable | loose | `link` flaps | ≥ 3 flaps in 2 sim-min | reseat (permanent) | link_flap |
| cable | kinked | flaps + `crcPerMin` up | ≥ 3 flaps in 2 sim-min or crc > 20/min | reseat suppresses for 2–8 sim-h; replace | link_flap |
| sfp | dirty_optics | `crcPerMin` up, `rxDbm` low | crc > 20/min or rx < −12 dBm | clean | crc_errors |
| sfp | failing_laser | `rxDbm` falls over hours, then the link drops | rx < −14 dBm or link down > 30 sim-s | replace | link_flap |
| port | bad_port | flaps no matter what part is installed | same as loose | move port only | link_flap |
| dimm | failing_rows | `eccCorrectable` climbs, then `eccUncorrectable` +1 | > 50 correctable in 1 sim-h, or any uncorrectable | replace | ecc_memory |
| drive | media_wear | `reallocated` climbs, then `driveState=failed` | reallocated > 50, or failed | replace | disk_failure |
| fan | bearing_wear | `rpm` falls, then 0; device `tempC` rises | rpm < 40% of nominal, or device temp > 75 °C | replace | overheat |
| psu | input_fault | `psuInput` intermittently `lost` | ≥ 2 losses in 10 sim-min | reseat (50% fixes) or replace | psu_fault |

**Background noise (healthy parts):** device `tempC` drifts ±3 °C around a 38–45 °C baseline, `rpm` jitters ±3%, an occasional single CRC error appears (about 1 per sim-hour per port), and `rxDbm` sits at −3 to −6 ±0.3. Noise must never cross a detection threshold.

**Severity of the alert and the AI draft:** the engine sets a severity hint for each failure mode, for example an uncorrectable ECC error or a failed drive = high, device temp > 85 °C = critical, CRC only = medium. That hint goes into the alert text. The AI still decides the final severity.

## 7. Repair feedback

On every tick, the adapter reads tickets that have **changed since its last read**, resolved ones with a `resolution_action`, plus `installed_parts` rows added or removed since then. It passes them to the engine as events:

| Event | Effect on the part's condition |
|---|---|
| `reseated` | loose cable → healthy. kinked cable → `suppressedUntil = now + rand(2,8) sim-h`. psu input_fault → 50% healthy, otherwise suppressed for 1–4 sim-h. Anything else → no effect. |
| `cleaned` | dirty_optics → healthy. Anything else → no effect. |
| `config_change`, `firmware_update` | suppressed for 1–6 sim-h, cause unchanged |
| part replaced (old row gets `removed_at`, a new row appears) | old condition dropped. New part gets a fresh draw (§5, DOA chance). A `bad_port` defect on the **position** stays, so the flaps continue and the AI's `move_port` recommendation becomes the right answer. |
| `replaced_part` resolution without a new part row | treated like `reseated` (the technician didn't actually swap the part) |

This is what makes "reseating hasn't held" happen without being scripted.

## 8. From alert to ticket

1. A detection rule fires and inserts an `alerts` row immediately.
2. **Duplicate check:** if an open ticket (`ai_draft`, `open` or `in_progress`) exists for the same `position_id` and category, the simulator adds a work-log entry to it (`kind: note`, `internal: true`, author `user-monitor`, alert text as the body) and links the alert to that ticket. Stop.
3. **Throttle:** at most 1 new ticket per `minTicketGapSec` (default 30 real seconds) and at most `maxOpenSimTickets` (default 8) open tickets reported by `user-monitor`. If over either limit, the alert is stored without a ticket.
4. `POST /api/ai/draft-ticket` with header `x-user-id: user-monitor`, using the alert text as `reportText`. Example: *"Monitoring: SW-C4-01 port-13 link flapped 6 times in 2 min; CRC 34/min. Possible link_flap. Severity hint: high."*
5. `POST /api/tickets` with `{...draft, status: "ai_draft"}`. The ticket lands in **AI Drafts** and a human must approve it. The simulator never approves, resolves or closes tickets.
6. **If the draft or create call fails:** log the error and keep the alert with `ticket_id = null`. The next alert for that position retries the draft. There's no template fallback.

**`user-monitor`:** added to `seed/base.json` as "NorthMark Monitoring", `org-northmark`, role `technician`, approved for both tenants, so the API's access checks pass.

## 9. Storage (migration requested from Person B)

```sql
create table sim_part_state (
  id text primary key,                 -- partId, or 'pos:'||position_id for position-level defects
  part_id text references installed_parts(id) on delete cascade,
  position_id text not null references positions(id),
  defect text,                         -- FailureMode or null
  severity real not null default 0,
  onset_sim_s real not null default 0,
  wear real not null default 1,
  suppressed_until_sim_s real,
  updated_at timestamptz not null default now()
);

create table position_metrics (
  position_id text primary key references positions(id),
  metrics jsonb not null,              -- kind-specific, see §10
  updated_at timestamptz not null default now()
);

create table alerts (
  id text primary key default gen_random_uuid()::text,
  position_id text not null references positions(id),
  device_id text not null references devices(id),
  rack_id text not null references racks(id),
  tenant_id text not null references orgs(id),
  category text not null,
  severity text not null check (severity in ('low','medium','high','critical')),
  message text not null,
  ticket_id text references tickets(id) on delete set null,
  created_at timestamptz not null default now(),
  cleared_at timestamptz
);
create index on alerts (position_id, created_at);

create table sim_control (
  id int primary key default 1 check (id = 1),
  paused boolean not null default false,
  speed real not null default 60,
  seed bigint,
  scenario text,
  sim_time_s real not null default 0,
  heartbeat_at timestamptz             -- sim writes every tick; /sim shows "running" if fresh
);

create table sim_commands (
  id text primary key default gen_random_uuid()::text,
  kind text not null check (kind in ('break')),
  position_id text not null references positions(id),
  failure_mode text not null,
  created_by text not null references users(id),
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

alter publication supabase_realtime add table position_metrics, alerts, sim_control;
```

**Writes:** the engine keeps every position in memory. The adapter flushes only changed `position_metrics` rows, in one batched upsert every `flushMs` (default 2000). Alerts are inserted as soon as they fire. `sim_control.heartbeat_at` and `sim_time_s` are written once per flush.

**Access:** `alerts` and `position_metrics` are read through API routes that check `canSeeTenant`. `sim_part_state` is never read by the app (only by the stretch-goal x-ray view).

## 10. Metric shapes (`position_metrics.metrics`)

| Position kind | Fields |
|---|---|
| port / uplink | `link: "up"\|"down"`, `flaps5m: number`, `crcPerMin: number`, `rxDbm?: number` (uplinks with an SFP) |
| dimm_slot | `eccCorrectable: number`, `eccUncorrectable: number` |
| drive_bay | `reallocated: number`, `driveState: "ok"\|"degraded"\|"failed"` |
| fan_bay | `rpm: number`, `nominalRpm: number` |
| psu_bay | `psuInput: "ok"\|"lost"`, `watts: number` |

Device temperature (`tempC`) goes on the device's `fan-1` position row, so there's no separate device-metrics table.

## 11. Scenarios

`lib/sim/scenarios/<name>.json`:

```json
{
  "name": "demo-port13",
  "seed": null,
  "pins": [
    { "positionId": "SW-C4-01/port-13", "target": "part", "defect": "kinked", "severity": 0.8,
      "onsetRealSec": [30, 90] }
  ],
  "config": { "minDefectsPerTenant": 2 }
}
```

- `pins` override the random draw for specific positions. `onsetRealSec` converts to simulated time using the current speed.
- `seed: null` means use the clock. A number pins it, which is useful for rehearsing.
- `config` overrides `lib/sim/config.ts` defaults.
- Everything not pinned stays random, so even the recording run has unscripted background events.

## 12. `/sim` page (shift_lead and admin only)

- **Status:** running or stale (heartbeat older than 5 s), seed, scenario, simulated clock, number of alerts and simulator tickets.
- **Controls:** pause/resume, a speed slider (10–600), writing to `sim_control` through `PATCH /api/sim/control`.
- **Break something:** pick rack, then device, then position (only positions the user can see), then a failure mode valid for that position kind from §6. This calls `POST /api/sim/commands`, which inserts into `sim_commands`. The simulator consumes the command on its next tick, giving that position the defect with onset = now.
- **Recent alerts feed:** last 20 alerts over Realtime, each linked to its ticket.

Routes in `app/api/sim/**` check `getCurrentUser` and require the `shift_lead` or `admin` role.

## 13. Where it shows up in the UI

- **ItemDrawer (Person C):** a **Live** section for the selected position, showing its `position_metrics` with Realtime updates and red out-of-range values. Read through `GET /api/sim/metrics/:positionId`, access-checked.
- **3D floor (needs Person B):** FloorView `highlights` and `worstSeverity` also count **uncleared alerts**, so a fault glows as soon as it's detected, before anyone approves the draft.
- **Board (Person B, already planned):** simulator tickets appear in AI Drafts.

## 14. Reset (`--reset`)

The rule is that anything whose id isn't in `seed/base.json` was created during a run. In order:

1. Delete `tickets` whose id isn't in `base.json`. Work log and handoffs cascade.
2. Delete `installed_parts` whose id isn't in `base.json` (replacement parts).
3. Re-upsert `installed_parts`, `tickets` and `work_log` from `base.json`, restoring `removed_at`, assignees and statuses on seeded rows.
4. Truncate `alerts`, `position_metrics`, `sim_commands` and `sim_part_state`, and reset the `sim_control` row.
5. Redraw hidden defects with a new seed, or `--seed N`, or the scenario's seed.

**Caveat:** this also deletes tickets someone added by hand during the session. Reset never touches orgs, users, racks, devices or positions.

## 15. Config defaults (`lib/sim/config.ts`)

```ts
export const SIM_CONFIG = {
  speed: 60,                 // sim-s per real-s
  tickMs: 1000,
  flushMs: 2000,
  minDefectsPerTenant: 3,
  onsetWindowSimMin: 60,
  doaChance: 0.02,
  minTicketGapSec: 30,       // real seconds
  maxOpenSimTickets: 8,
  wearPerYear: { cable: 0.5, sfp: 0.4, drive: 0.6, fan: 0.5, dimm: 0.2, psu: 0.3 },
  defectChance: { cable: 0.04, sfp: 0.03, drive: 0.02, fan: 0.02, dimm: 0.01, psu: 0.01, port: 0.005 },
};
```

Tune these by trial with `--dry-run`. The aim is something noteworthy every 60–90 real seconds at the default speed.

## 16. Dependencies on Person B

1. A migration with §9's tables and Realtime publication.
2. `POST /api/tickets` (already in B's task list), accepting `status: "ai_draft"`.
3. FloorView counts uncleared `alerts` in `highlights` and `worstSeverity`.
4. Optional: the board shows a 🤖 marker on tickets reported by `user-monitor`.

Until (1) and (2) land, use `--dry-run` for engine work.

## 17. Stretch goal

- **X-ray view (admin):** a toggle on `/sim` that shows `sim_part_state`, so after a repair you can show judges that the technician's diagnosis and the AI's recommendation matched the hidden cause.
