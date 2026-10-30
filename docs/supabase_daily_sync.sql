-- MusicGraph 每日同步安全升级
-- 用途：防止自动排期与人工审核排期重复，并记录自动数据与人工数据的冲突。
-- 执行：在 Supabase SQL Editor 粘贴整个文件运行（上线每日安全同步前执行一次）。

-- 旧数据中的空值统一为空字符串，避免 Postgres UNIQUE 对 NULL 放行重复行。
-- 如果历史上已因 NULL 产生重复场次，先把卡司合并到最小 ID 的场次。
with ranked as (
  select id,
         min(id) over (
           partition by coalesce(date, ''), coalesce(time, ''), coalesce(city, ''),
                        coalesce(musical, ''), coalesce(theatre, '')
         ) as keeper_id
  from shows
)
update show_casts sc
set show_id = ranked.keeper_id
from ranked
where sc.show_id = ranked.id and ranked.id <> ranked.keeper_id;

with ranked as (
  select id,
         min(id) over (
           partition by coalesce(date, ''), coalesce(time, ''), coalesce(city, ''),
                        coalesce(musical, ''), coalesce(theatre, '')
         ) as keeper_id
  from shows
)
delete from shows s using ranked
where s.id = ranked.id and ranked.id <> ranked.keeper_id;

update shows
set date = coalesce(date, ''),
    time = coalesce(time, ''),
    city = coalesce(city, ''),
    musical = coalesce(musical, ''),
    theatre = coalesce(theatre, '');

alter table shows alter column date set default '';
alter table shows alter column time set default '';
alter table shows alter column city set default '';
alter table shows alter column musical set default '';
alter table shows alter column theatre set default '';
alter table shows alter column date set not null;
alter table shows alter column time set not null;
alter table shows alter column city set not null;
alter table shows alter column musical set not null;
alter table shows alter column theatre set not null;

update show_casts set role = coalesce(role, '');
alter table show_casts alter column role set default '';
alter table show_casts alter column role set not null;

-- 清理完全重复的卡司，再阻止以后重复写入。
delete from show_casts a
using show_casts b
where a.ctid > b.ctid
  and a.show_id = b.show_id
  and a.artist_id = b.artist_id
  and a.role = b.role;

create unique index if not exists uq_show_casts_show_artist_role
  on show_casts(show_id, artist_id, role);

-- 自动同步只写入此表，不覆盖人工维护字段。无匿名访问策略，前端用户不可见。
create table if not exists sync_conflicts (
  fingerprint text primary key,
  entity_type text not null,
  record_key jsonb not null default '{}'::jsonb,
  field_name text not null,
  existing_value text,
  incoming_value text,
  incoming_source text not null default 'y.saoju',
  status text not null default 'pending' check (status in ('pending', 'resolved', 'ignored')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists idx_sync_conflicts_pending
  on sync_conflicts(status, last_seen_at desc);

create or replace function touch_sync_conflict() returns trigger language plpgsql as $$
begin
  new.last_seen_at := now();
  return new;
end $$;

drop trigger if exists trg_sync_conflicts_touch on sync_conflicts;
create trigger trg_sync_conflicts_touch before update on sync_conflicts
  for each row execute function touch_sync_conflict();

alter table sync_conflicts enable row level security;

comment on table sync_conflicts is
  '自动数据与 Supabase 人工维护数据的冲突；仅 service role 和管理员后台处理。';
