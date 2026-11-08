-- OWNER: Person B. Only Person B adds migrations.
--
-- Storage for the hardware simulator (docs/SIM-SPEC.md section 9), requested by Person C.
--
-- Row level security: Supabase turns it on for new tables, and a table with RLS on and no policy
-- makes Realtime silently drop INSERT and UPDATE events (DELETE still arrives). The browser listens
-- to these tables only as a "something changed" nudge and re-fetches through /api, where access is
-- enforced, so RLS is switched off on the tables Realtime watches and writes are taken away from
-- the public anon key. The server keeps working through the service-role key.
-- sim_part_state and sim_commands are never read by the browser, so they keep RLS on.
-- The two statements for tickets and handoffs are idempotent and record a step that earlier setups
-- did by hand in the SQL editor.

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
  metrics jsonb not null,              -- kind-specific, see SIM-SPEC section 10
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

-- The simulator expects the single control row to exist.
insert into sim_control (id) values (1) on conflict (id) do nothing;

alter publication supabase_realtime add table position_metrics, alerts, sim_control;

alter table tickets disable row level security;
alter table handoffs disable row level security;
alter table position_metrics disable row level security;
alter table alerts disable row level security;
alter table sim_control disable row level security;
revoke insert, update, delete on tickets, handoffs, position_metrics, alerts, sim_control from anon;
