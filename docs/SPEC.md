# NMC² Ops — Spec

**Track:** NorthMark Compute & Cloud — *Keep the World Running.*
**Problem:** In colocation data centers, the same component fails over and over, and each technician fixes it again without knowing it has happened before. When a shift ends, context gets lost because nobody knows what the outgoing technician was in the middle of.
**Product:** Ticketing at the component level, with each position's history kept, repeat failures detected, and handoffs between shifts that carry context. A 3D digital twin shows exactly where the problem is.

## Core concepts

### Item tree
`Rack → Device → Position → InstalledPart`

- **Position** is a permanent location: `SW-C4-01/port-13`, `SRV-C4-07/dimm-A4`, a drive bay, a PSU bay, a fan bay. **History is keyed to the position.**
- **InstalledPart** is a replaceable thing in a position: a transceiver, a cable, a DIMM, a drive, a PSU, a fan. Replacing one creates a new part row, sets `removed_at` on the old one, and logs a `part_replaced` work-log entry.
- A ticket can attach to any level of the tree. History shown at any level includes everything inside it.

### Tickets
- Columns: **AI Drafts → Open → In Progress → Resolved**.
- A technician or tenant engineer types a report. The AI drafts a ticket (title, description, severity, category, rack/device/position), and a human approves it, which moves it from `ai_draft` to `open`.
- **Work log**: timestamped entries on each ticket. Entries marked `internal` are hidden from tenant viewers.
- **Resolving requires**: a category (dropdown), an action taken (dropdown), and a note. Dragging a card to Resolved always opens the resolve form.
- Cards show the item path (`C4 › SW-C4-01 › port-13`), severity, the assignee's avatar, and a ⚠ Replace? badge.

### Repeat rule (deterministic) + AI summary
- **3 or more tickets (resolved, open or in progress) on the same position with the same category within 30 days, counting only those since the last part replacement in that position**, sets `replace_suggested`. The ticket being worked now counts, so the live report is what tips a position over. See the `repeat_flags` view in `supabase/migrations/0002_repeat_flags_count_open.sql`.
- The AI writes a **known-issue summary** from past resolutions. For example: "Reseating hasn't held, so replace the cable or transceiver", or after a replacement, "Cable replaced 6 days ago and the issue persists, so suspect the port; move to port 15 or RMA the switch."

### Shift handoff
1. **End shift** lists the outgoing technician's open assigned tickets.
2. For each one, the AI drafts a handoff note from the work log and position history: what's been done, what's left, and what to watch. The technician edits it.
3. The technician picks a receiver. **Only technicians approved for that ticket's tenant are offered.**
4. The receiver gets a live notice (Supabase Realtime) and a **shift brief**. **Acknowledging** a handoff reassigns the ticket to them. Handoffs that haven't been acknowledged show a warning badge.

### Access (simulated)
- Every user belongs to one org: **NorthMark** (the operator) or a **tenant** (Acme, Globex).
- Roles:
  - `tenant_viewer`: sees ticket status only, with no internal notes.
  - `tenant_engineer`: files and works tickets on their own org's equipment.
  - `technician`: works tickets for the tenants they're approved for.
  - `shift_lead`: everything a technician can do, plus seeing everything and assigning tickets.
  - `admin`: edits users, roles and approvals.
- NorthMark technicians hold **per-tenant approvals** (`approved_tenant_ids`).
- An account switcher in the top bar sets the `x-user-id` header. **Route handlers enforce access** through `lib/access.ts`. The server computes floor visibility, and racks outside your scope render as grey, unlabelled boxes.
- The **admin page** edits role and approvals, and changes take effect immediately.

### 3D
- **Floor**: 8 racks in 2 rows that glow by worst open severity. Clicking a rack or ticket moves the camera in to the device, which highlights the position. A ticket side panel sits beside the 3D view, and the board is a separate page.
- **Chassis builder**: one function that turns `seed/device-models.json` (spec-sheet dimensions) into a box plus grids of named meshes. Mesh name = `Position.localId`. It covers one 48-port 1U switch and one 2U 12-bay server. PDUs, patch panels and fillers are plain boxes.
- **Interface**: `<DeviceViewer deviceId highlights={Highlight[]} onSelect={(localId) => …} />`.
- **Guided repair** (built last): a step-by-step 3D animation of swapping a cable or transceiver, with a caption and a Next button for each step.

### AI
- Any OpenAI-compatible endpoint, configured with `LLM_BASE_URL`, `LLM_MODEL` and `LLM_API_KEY`. Credits come from Brev/Nemotron.
- Three prompts: **report → ticket draft**, **known-issue summary**, **handoff note**.
- Output is structured JSON validated with zod, with one retry. **Cached fallbacks** for the scripted demo inputs live in `seed/demo.json`.

## Stack
- Next.js 15 (App Router) + TypeScript + Tailwind 4
- react-three-fiber + drei + postprocessing (bloom for the neon glow)
- One shared hosted Supabase Postgres. Only Person B adds migrations, and `npm run seed` is safe to re-run.
- Everyone runs locally. Nothing is deployed.
- Theme: cyberpunk / Blade Runner, using the tokens in `app/globals.css`.

## Demo (screen recording, about 3–4 minutes)
1. **Alex (night technician)**: rack C4 glows amber. Alex reports *"port 13 on the C4 top switch dropping again"*, the AI draft has `SW-C4-01/port-13` filled in, and Alex approves it.
2. The camera moves to the switch and port 13 glows red. The drawer shows 2 earlier link-flaps this month, both reseated, with ⚠ Replace? and the AI summary: "Reseating hasn't held; replace cable/SFP."
3. Alex logs "replacement cable requested" and clicks **End shift**. The AI drafts the handoff note, and Alex sends it to Sam.
4. **Sam (morning technician)**: a live notice appears. Sam opens the shift brief, acknowledges the ticket (now assigned to Sam), and walks through the **guided cable swap** in 3D. Sam then replaces the part with a new serial and resolves the ticket. The repeat count starts over.
5. **Kim (Acme tenant viewer)**: sees only Acme's racks, and sees "Resolved — cable replaced" with no internal notes.
6. *(Optional)* **Dana (admin)** revokes Sam's Acme approval, and Sam disappears from the handoff picker.

## Out of scope
Real authentication, the live alert simulator (seeded alerts only if the team is ahead at hour 8), serial-number tracking across hosts, voice input, mobile layout, deployment.

## Ownership (~7h each)

| Person A — 3D | Person B — Data, board, access | Person C — AI, flows, demo data |
|---|---|---|
| `components/three/**` | `shared/**`, `supabase/**`, `db/**`, `lib/access.ts`, `lib/rules.ts`, `scripts/seed.ts` | `lib/ai/**`, `app/api/ai/**`, `app/api/handoffs/**` |
| `app/page.tsx` (floor), `seed/device-models.json` | `app/layout.tsx`, `app/globals.css`, `app/board/**`, `app/admin/**`, `components/board/**` | `app/shift/**`, `components/ai/**` (report modal, item drawer, shift brief) |
| Floor scene, severity glow, tenant greying (from `FloorView.visible`) | `app/api/**` except ai/handoffs | `seed/base.json`, `seed/demo.json` |
| Chassis builder, camera fly-in, highlight/select | Ticket API, board + dragging, work log, resolve form | LLM client, draft-ticket, known-issue, draft-handoff |
| `<DeviceViewer>` | Repeat rule, access checks, account switcher, admin page | Item drawer (history, Replace? badge, summary) |
| Guided repair animation (last) | Realtime (board + handoff notices) | End shift, shift brief, acknowledge |

**Rules:** only touch files you own. Changes to `shared/` go through Person B. Pull often and merge small. Until another person's route exists, read `seed/*.json` directly.

## Timeline (14h)

| Hour | Milestone |
|---|---|
| 0–1 | Keys, Supabase project, migration applied, seed run, everyone runs `npm run dev` |
| 1–8 | Parallel build |
| **8** | **Integration checkpoint**: the demo runs end to end, even if rough |
| 8–11 | Guided repair, admin page, polish |
| **11** | **Feature freeze** |
| 11–13 | Record the video, write the README, make the slides |
| 13–14 | Buffer and submit |
