# Person C — task list (AI, flows, demo data)

Work through these in order. Run `/implement c` to pick up the next unchecked item.

---

- [x] **`seed/base.json`** — base seed data
  Produce a JSON object with keys matching DB table names. Must include:
  - **orgs**: `org-northmark` (operator), `org-acme` (tenant), `org-globex` (tenant).
  - **users**: Alex (technician, approved: acme+globex), Sam (technician, approved: acme+globex), Morgan (shift_lead, approved: acme+globex), Kim (tenant_viewer, org: acme), Taylor (tenant_engineer, org: globex), Dana (admin, org: northmark).
  - **racks**: 8 racks, 2 rows × 4 cols: C1–C4 (row 1, tenant acme), C5–C8 (row 2, tenant globex).
  - **devices**: each rack gets one `switch-48p-1u` (uPosition 42) and one `server-2u` (uPosition 1). IDs: `SW-C4-01`, `SRV-C4-01`, etc.
  - **positions**: generate all 48 `port-N` + 4 `uplink-N` + 2 `psu-N` + 3 `fan-N` for each switch; 12 `bay-N` + 32 `dimm-A-N`/`dimm-B-N` + 2 `psu-N` + 6 `fan-N` for each server.
  - **installed_parts**: one part per position (plausible serials, `installed_at` varied).
  - **tickets**: at least 6 resolved `link_flap` tickets on `SW-C4-01/port-13` within last 30 days (to trigger `replace_suggested`), plus a few open tickets on other positions across both tenants.
  - **work_log**: plausible entries for the scripted demo tickets.

- [x] **`/api/ai/draft-ticket`** — `app/api/ai/draft-ticket/route.ts`
  POST `{reportText}` → `TicketDraft`.
  - System prompt: given the floor layout (racks, devices, positions), parse the report and return JSON with all `TicketDraft` fields. Zod schema matches `shared/types.ts#TicketDraft`.
  - Fallback key for `seed/demo.json`: `"draft-ticket:${reportText.trim().toLowerCase().slice(0,80)}"`.

- [x] **`/api/ai/known-issue/[positionId]`** — `app/api/ai/known-issue/[positionId]/route.ts`
  GET → `KnownIssueSummary`.
  - Fetch `PositionHistory` from `/api/positions/:id/history` internally (or replicate the query).
  - Prompt: summarise the history of resolved tickets + part replacements; output `{positionId, summary, recommendation}`.
  - Fallback key: `"known-issue:${positionId}"`.

- [x] **`/api/ai/draft-handoff`** — `app/api/ai/draft-handoff/route.ts`
  POST `{ticketId}` → `{note: string}`.
  - Fetch ticket + work-log entries + position history.
  - Prompt: write a concise shift handoff note covering what's been done, current state, and what to watch.
  - Fallback key: `"draft-handoff:${ticketId}"`.

- [x] **`/api/handoffs` routes** — `app/api/handoffs/route.ts`
  GET `?to=me` → `Handoff[]` where `to_user_id = currentUser.id`, ordered newest first.
  POST `{ticketId, toUserId, note}` → `Handoff`. Checks sender is assigned to the ticket. Adds `handoff` work-log entry.

- [x] **`/api/handoffs/[id]/ack`** — `app/api/handoffs/[id]/ack/route.ts`
  POST → `Handoff`. Sets `acknowledged_at = now()`. Reassigns ticket to `handoff.toUserId` via `PATCH /api/tickets/:id`.

- [x] **`<ReportModal>`** — `components/ai/ReportModal.tsx`
  Triggered by a "Report issue" button (wire into `app/layout.tsx` TODO slot).
  - Textarea for free-text report + Submit → calls `api.draftTicket(reportText)`.
  - Shows draft fields (title, description, severity select, category select, rack/device/position path) all editable.
  - "Approve" → `api.createTicket({...draft, status: "open"})` → closes modal.
  - Loading spinner while drafting; shows confidence badge.

- [x] **`<ItemDrawer>`** — `components/ai/ItemDrawer.tsx`
  Receives `positionId` (from A's `onSelect` callback via `app/page.tsx` aside).
  - Fetches `PositionHistory` via `api.history(positionId)`.
  - Shows ticket list (newest first), part-event timeline.
  - If any `RepeatFlag` has `replaceSuggested`, shows ⚠ Replace? badge.
  - Fetches `KnownIssueSummary` via `api.knownIssue(positionId)` and renders `summary` + `recommendation` pill.

- [x] **`app/shift/page.tsx`** — End Shift flow
  - Lists the current user's open assigned tickets.
  - Per ticket: "Draft handoff" button → calls `api.draftHandoff(ticketId)` → editable textarea pre-filled with the note.
  - Receiver picker: `api.assignable(ticketId)` → dropdown of approved techs (excluding self).
  - "Send" → `api.createHandoff({ticketId, toUserId, note})`.
  - Sent handoffs show a "Sent ✓" state.

- [x] **`<ShiftBrief>`** — `components/ai/ShiftBrief.tsx`
  Fetches `api.handoffs()` on mount and on Realtime INSERT (Person B provides the subscription hook).
  - Lists pending handoffs with ticket title, from-user, note preview.
  - "Acknowledge" → `api.ackHandoff(id)` → reassigns ticket, removes from list.
  - Unacknowledged count badge on the Shift nav link (export a count so layout can render it).
  Wire into `app/shift/page.tsx` above the End Shift form.

- [x] **`seed/demo.json`** — cached AI responses for the scripted demo
  Keys are the fallback strings used in the route handlers above. Must cover:
  - `"draft-ticket:port 13 on the c4 top switch dropping again"` → TicketDraft for SW-C4-01/port-13, severity: high, category: link_flap.
  - `"known-issue:SW-C4-01/port-13"` → KnownIssueSummary: "Reseating hasn't held; replace cable/SFP.", recommendation: replace_part.
  - `"draft-handoff:<the port-13 ticket id>"` → note covering 2 prior reseats, cable-request work-log, ask Sam to do the swap.
  - Two more fallbacks for variety (another position, another category).

---

## Hardware simulator (see `docs/SIM-SPEC.md`)

- [x] **Sim engine core** — `lib/sim/engine/**`, `lib/sim/config.ts`
  Pure TS, no I/O. Seeded RNG (`rng.ts`), defect draw per part + position-level `bad_port` with per-kind chances, wear, `minDefectsPerTenant` guarantee, onset spread (SIM-SPEC §4–5, §15). `tick(state, commands, events, dtSim)` → `{state, changedMetrics, alerts}`.

- [x] **Failure catalogue + detection** — `lib/sim/engine/modes.ts`, `lib/sim/engine/detect.ts`
  All 9 failure modes from SIM-SPEC §6 with metric signals (§10), healthy background noise that never crosses thresholds, detection rules → alerts with severity hint and machine-readable message.

- [x] **Repair feedback** — `lib/sim/engine/repair.ts`
  Apply resolution actions and part replacements to hidden conditions per SIM-SPEC §7 (reseat/clean/config/replace, DOA draw, `bad_port` survives part swaps).

- [x] **`scripts/sim.ts` + `--dry-run`** — CLI flags (§2), dry-run reads `seed/base.json`, runs N sim-minutes as fast as possible, prints events. Same seed ⇒ identical output. Tune `config.ts` so something notable happens every 60–90 real s at default speed.

- [x] **Scenarios** — `lib/sim/scenarios/demo-port13.json` + loader
  Pins, optional seed, config overrides (§11). `--scenario demo-port13` makes SW-C4-01/port-13 cable `kinked`, first flap 30–90 real s.

- [x] **`user-monitor` seed user** — `seed/base.json`
  "NorthMark Monitoring", `org-northmark`, technician, approved acme + globex.

- [x] **Supabase adapter** — `lib/sim/adapter.ts` *(needs B's sim migration — written to SIM-SPEC §9, run loop tested with an in-memory store, **not yet run against a real DB**)*
  Load parts/positions, persist `sim_part_state`, batched `position_metrics` flush every `flushMs`, insert alerts immediately, heartbeat + sim time to `sim_control`, consume `sim_commands`, read resolved tickets / part changes as repair events.

- [x] **Alert → ticket pipeline** — `lib/sim/pipeline.ts`, wired in `lib/sim/runner.ts` *(tested with fakes; the real draft-ticket → POST /api/tickets path is untested)*
  Dedupe (work-log onto existing open ticket), throttle (`minTicketGapSec`, `maxOpenSimTickets`), `draft-ticket` as `user-monitor`, create as `ai_draft`. On failure: log, keep alert with `ticket_id null`, retry on next alert (§8).

- [x] **`--reset`** — `scripts/sim.ts`, `lib/sim/reset.ts` *(not run against a real DB yet)*
  Delete tickets/parts not in `base.json`, re-upsert seeded parts/tickets/work_log, truncate sim tables, redraw (§14).

- [x] **Sim API routes** — `app/api/sim/**` *(type-checked only; needs B's sim migration to run)*
  `GET/PATCH /api/sim/control`, `POST /api/sim/commands` (break), `GET /api/sim/alerts` (recent, access-filtered), `GET /api/sim/metrics/[positionId]`. shift_lead/admin for control + commands; `canSeeTenant` for reads.

- [x] **`/sim` page** — `app/sim/page.tsx`, `components/sim/**` *(builds; not exercised against a DB; no nav link yet because `app/layout.tsx` is B's)*
  Status + heartbeat, pause/resume, speed slider, Break-something picker (rack → device → position → valid mode), Realtime recent-alerts feed (§12).

- [x] **ItemDrawer Live section** — `components/ai/ItemDrawer.tsx`, `components/ai/LiveMetrics.tsx` *(builds; not exercised against a DB)*
  Show `position_metrics` for the selected position with Realtime updates; out-of-range values highlighted (§13).

- [ ] **Stretch: X-ray view** — admin-only toggle on `/sim` showing hidden `sim_part_state` (§17).
