-- OWNER: Person B. Only Person B adds migrations. Mirrors shared/types.ts.
-- Access control is simulated (x-user-id header) and enforced in Next.js route
-- handlers via lib/access.ts, so RLS is off and the server uses the service-role key.

create table orgs (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('operator', 'tenant'))
);

create table users (
  id text primary key,
  name text not null,
  email text not null unique,
  org_id text not null references orgs(id),
  role text not null check (role in ('tenant_viewer','tenant_engineer','technician','shift_lead','admin')),
  approved_tenant_ids text[] not null default '{}',
  avatar_color text not null default '#00f0ff'
);

create table racks (
  id text primary key,
  label text not null,
  row int not null,
  col int not null,
  tenant_id text not null references orgs(id),
  height_u int not null default 42
);

create table devices (
  id text primary key,
  rack_id text not null references racks(id),
  kind text not null check (kind in ('switch','server','pdu','patch_panel','filler')),
  model_id text not null,
  u_position int not null,
  name text not null
);

create table positions (
  id text primary key,                -- "<deviceId>/<localId>"
  device_id text not null references devices(id),
  local_id text not null,             -- matches chassis-builder mesh name
  kind text not null check (kind in ('port','dimm_slot','drive_bay','psu_bay','fan_bay')),
  label text not null,
  unique (device_id, local_id)
);

create table installed_parts (
  id text primary key default gen_random_uuid()::text,
  position_id text not null references positions(id),
  kind text not null check (kind in ('sfp','cable','dimm','drive','psu','fan')),
  serial text not null,
  installed_at timestamptz not null default now(),
  removed_at timestamptz
);
create index on installed_parts (position_id);

create table tickets (
  id text primary key default gen_random_uuid()::text,
  title text not null,
  description text not null default '',
  status text not null check (status in ('ai_draft','open','in_progress','resolved')),
  severity text not null check (severity in ('low','medium','high','critical')),
  category text not null check (category in ('link_flap','crc_errors','overheat','ecc_memory','disk_failure','psu_fault','other')),
  tenant_id text not null references orgs(id),
  rack_id text not null references racks(id),
  device_id text references devices(id),
  position_id text references positions(id),
  part_id text references installed_parts(id),
  reporter_id text not null references users(id),
  assignee_id text references users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_action text check (resolution_action in ('reseated','replaced_part','cleaned','config_change','firmware_update','other')),
  resolution_note text
);
create index on tickets (position_id, category, resolved_at);
create index on tickets (status);

create table work_log (
  id text primary key default gen_random_uuid()::text,
  ticket_id text not null references tickets(id) on delete cascade,
  author_id text not null references users(id),
  kind text not null check (kind in ('note','status_change','part_replaced','handoff','resolution')),
  body text not null,
  internal boolean not null default true,
  created_at timestamptz not null default now()
);
create index on work_log (ticket_id, created_at);

create table handoffs (
  id text primary key default gen_random_uuid()::text,
  ticket_id text not null references tickets(id) on delete cascade,
  from_user_id text not null references users(id),
  to_user_id text not null references users(id),
  note text not null,
  status text not null default 'pending' check (status in ('pending','acknowledged')),
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz
);

-- Repeat rule: resolved tickets per position+category in last 30 days,
-- counting only those after the most recent part replacement in that position.
create view repeat_flags as
select
  t.position_id,
  t.category,
  count(*)::int as count,
  30 as window_days,
  count(*) >= 3 as replace_suggested
from tickets t
where t.position_id is not null
  and t.status = 'resolved'
  and t.resolved_at > now() - interval '30 days'
  and t.resolved_at > coalesce(
    (select max(p.installed_at) from installed_parts p
      where p.position_id = t.position_id
        and exists (select 1 from installed_parts old
                    where old.position_id = p.position_id and old.removed_at is not null)),
    '-infinity'::timestamptz)
group by t.position_id, t.category;

-- Realtime for the board and incoming handoff toasts.
alter publication supabase_realtime add table tickets, handoffs;
