# Person B — task list (data, API, board, access)

Work through these in order. Run `/implement b` to pick up the next unchecked item.

---

- [x] **`lib/rules.ts`** — repeat-flag logic
  Export `getRepeatFlags(positionId: string): Promise<RepeatFlag[]>`.
  - Query `installed_parts` for the most-recent `removed_at` on this position (= last replacement).
  - Query `tickets` for resolved tickets on this position with matching category since that date (or all time if no replacement).
  - Group by category; set `replaceSuggested: count >= 3`, `windowDays: 30`.
  - Return one `RepeatFlag` per category that has at least one entry.

- [x] **`scripts/seed.ts`** — idempotent seeder
  Reads `seed/base.json`, upserts every table in dependency order (orgs → users → racks → devices → positions → installed_parts → tickets → work_log → handoffs).
  Use `db.from(table).upsert(rows, { onConflict: "id" })`. Log counts. `npm run seed` must be safe to re-run.

- [x] **`/api/floor` route** — `app/api/floor/route.ts`
  GET → `FloorView`. For each rack, check `canSeeTenant(user, rack.tenantId)` for `visible`. Compute `worstSeverity` from open tickets on devices in that rack. Only return devices for visible racks.

- [x] **`/api/tickets` routes** — `app/api/tickets/route.ts`
  GET `?status=` → `Ticket[]` filtered by status (omit param = all). Guard by `canSeeTenant`.
  POST `{TicketDraft & {status}}` → `Ticket`. Requires `canWorkTenant`.

- [x] **`/api/tickets/[id]` routes** — `app/api/tickets/[id]/route.ts`
  GET → `{ ticket, workLog }`. Filter `workLog` entries by `canSeeInternal`.
  PATCH `{status?, assigneeId?}` → `Ticket`. Guards apply.

- [x] **`/api/tickets/[id]/resolve`** — `app/api/tickets/[id]/resolve/route.ts`
  POST `{category, action, note}` → `Ticket`. Sets `resolvedAt`, writes a `resolution` work-log entry.

- [x] **`/api/tickets/[id]/log`** — `app/api/tickets/[id]/log/route.ts`
  POST `{body, internal}` → `WorkLogEntry`. Reject `internal: true` unless `canSeeInternal`.

- [x] **`/api/tickets/[id]/assignable`** — `app/api/tickets/[id]/assignable/route.ts`
  GET → `User[]`. Returns all users where `isAssignable(user, ticket.tenantId)`.

- [x] **`/api/parts/[id]/replace`** — `app/api/parts/[id]/replace/route.ts`
  POST `{serial}` → new `InstalledPart`. Sets `removed_at` on old part, inserts new row, adds `part_replaced` work-log entry on the ticket (if any open ticket targets this position).

- [x] **`/api/positions/[id]/history`** — `app/api/positions/[id]/history/route.ts`
  GET → `PositionHistory`. Assembles position, device, currentParts, all tickets (newest first), all partEvents, repeatFlags (from `lib/rules.ts`).

- [x] **`/api/users` routes** — `app/api/users/route.ts` and `app/api/users/[id]/route.ts`
  GET → `User[]` (all, admin only).
  PATCH `{role?, approvedTenantIds?}` → `User` (admin only).

- [x] **`<AccountSwitcher>`** in `app/layout.tsx`
  Client component: fetches `/api/users`, renders a `<select>` in the top-right nav slot.
  On change, calls `setCurrentUserId(id)` from `shared/api.ts`. Labels each option as `${name} (${role})`.

- [x] **`<KanbanBoard>` component** — `components/board/KanbanBoard.tsx`
  Four columns: AI Drafts · Open · In Progress · Resolved.
  - Drag a card between columns → `api.patchTicket(id, { status })`.
  - Dropping on **Resolved** opens a resolve modal (`category` dropdown, `action` dropdown, `note` textarea) → `api.resolveTicket`.
  - Card shows: item path (`C4 › SW-C4-01 › port-13`), severity badge (colour by sev token), assignee avatar circle, ⚠ Replace? badge when `replaceSuggested`.
  - Use the HTML5 drag-and-drop API (no extra libs).

- [x] **Board page** — `app/board/page.tsx`
  Loads `api.tickets()`, renders `<KanbanBoard>`. Polling or realtime refresh every 10 s.

- [ ] **Admin page** — `app/admin/page.tsx`
  Table of all users. Each row: name, role select, approved-tenant checkboxes (Acme / Globex).
  On blur/change → `api.patchUser`. Restricted: render empty with "access denied" for non-admins.

- [ ] **Supabase Realtime** — board + handoff badge
  In `app/board/page.tsx`: subscribe to `tickets` INSERT/UPDATE → re-fetch or merge into state.
  In `app/layout.tsx` (or a provider): subscribe to `handoffs` INSERT where `to_user_id = currentUserId` → show a badge count in the nav Shift link.
