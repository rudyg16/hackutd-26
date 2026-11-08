-- OWNER: Person B. Only Person B adds migrations.
--
-- Repeat rule v2: the ticket being worked now counts toward the total.
-- The demo story needs the live report to be the one that tips a position over
-- the threshold ("2 earlier flaps + this one = Replace?"), which v1 could not do
-- because it only counted resolved tickets.
--
-- A ticket counts if it is resolved, open or in progress (unapproved AI drafts do
-- not). Its date is when it was resolved, or when it was filed if still unresolved.
-- Same window (30 days) and same "only since the last part replacement" cut-off.
--
-- Same columns and types as v1, so this is a plain replace and nothing that reads
-- the view (lib/rules.ts) changes. To undo: re-run the view definition in 0001.

create or replace view repeat_flags as
select
  t.position_id,
  t.category,
  count(*)::int as count,
  30 as window_days,
  count(*) >= 3 as replace_suggested
from tickets t
where t.position_id is not null
  and t.status in ('resolved', 'open', 'in_progress')
  and coalesce(t.resolved_at, t.created_at) > now() - interval '30 days'
  and coalesce(t.resolved_at, t.created_at) > coalesce(
    (select max(p.installed_at) from installed_parts p
      where p.position_id = t.position_id
        and exists (select 1 from installed_parts old
                    where old.position_id = p.position_id and old.removed_at is not null)),
    '-infinity'::timestamptz)
group by t.position_id, t.category;
