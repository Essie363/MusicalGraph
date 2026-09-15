-- MusicGraph 登录评分迁移
-- 执行位置：Supabase SQL Editor
-- 说明：
-- - 兼容当前前端已有 RPC 名称：get_my_rating / upsert_actor_rating 等。
-- - 未登录用户继续使用 p_anonymous_user_id。
-- - 登录用户使用 auth.uid()；同一用户对同一场次重复提交会覆盖更新。
-- - 不同场次会分别保存；公开汇总时先计算每位用户对同一角色的多场均值，
--   再由每位用户作为一票计入角色与演员的公开评分。

create table if not exists ratings (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade,
  anonymous_user_id text,
  actor_id integer not null references artists(id) on delete cascade,
  musical_id integer references musicals(id) on delete set null,
  role_id integer references roles(id) on delete set null,
  manual_musical_name text,
  manual_role_name text,
  performance_id integer references shows(id) on delete set null,
  performance_date date,
  session_period text check (session_period is null or session_period in ('matinee','evening','night')),
  rating_slot text not null,
  singing_score numeric(3,1) check (singing_score is null or (singing_score >= 0.5 and singing_score <= 5)),
  dancing_score numeric(3,1) check (dancing_score is null or (dancing_score >= 0.5 and dancing_score <= 5)),
  acting_score numeric(3,1) check (acting_score is null or (acting_score >= 0.5 and acting_score <= 5)),
  cast_mapping_status text not null default 'confirmed' check (cast_mapping_status in ('confirmed','pending','manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (musical_id is not null and role_id is not null)
    or (manual_musical_name is not null and manual_role_name is not null)
  )
);

create index if not exists idx_ratings_actor on ratings(actor_id);
create index if not exists idx_ratings_user on ratings(user_id) where user_id is not null;
create index if not exists idx_ratings_anon on ratings(anonymous_user_id) where anonymous_user_id is not null;

-- 兼容已上线的旧表：历史记录各自保留为一个独立场次槽位。
alter table ratings add column if not exists rating_slot text;
update ratings
set rating_slot = case
  when performance_id is not null then 'show:' || performance_id::text
  when performance_date is not null then 'date:' || performance_date::text || '|session:' || coalesce(session_period, 'unknown')
  else 'legacy:' || id::text
end
where rating_slot is null;
alter table ratings alter column rating_slot set not null;

drop index if exists uniq_ratings_user_known_subject;
drop index if exists uniq_ratings_anon_known_subject;
drop index if exists uniq_ratings_user_manual_subject;
drop index if exists uniq_ratings_anon_manual_subject;

create unique index if not exists uniq_ratings_user_known_subject
  on ratings(user_id, actor_id, musical_id, role_id, rating_slot)
  where user_id is not null and musical_id is not null and role_id is not null;

create unique index if not exists uniq_ratings_anon_known_subject
  on ratings(anonymous_user_id, actor_id, musical_id, role_id, rating_slot)
  where user_id is null and anonymous_user_id is not null and musical_id is not null and role_id is not null;

create unique index if not exists uniq_ratings_user_manual_subject
  on ratings(user_id, actor_id, lower(manual_musical_name), lower(manual_role_name), rating_slot)
  where user_id is not null and manual_musical_name is not null and manual_role_name is not null;

create unique index if not exists uniq_ratings_anon_manual_subject
  on ratings(anonymous_user_id, actor_id, lower(manual_musical_name), lower(manual_role_name), rating_slot)
  where user_id is null and anonymous_user_id is not null and manual_musical_name is not null and manual_role_name is not null;

create or replace function touch_rating_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_rating_updated_at on ratings;
create trigger trg_touch_rating_updated_at
before update on ratings
for each row execute function touch_rating_updated_at();

alter table ratings enable row level security;

drop policy if exists "ratings owner read" on ratings;
create policy "ratings owner read" on ratings
for select to authenticated
using (user_id = auth.uid());

drop policy if exists "ratings owner insert" on ratings;
create policy "ratings owner insert" on ratings
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "ratings owner update" on ratings;
create policy "ratings owner update" on ratings
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create or replace function rating_score_count(
  p_singing numeric,
  p_dancing numeric,
  p_acting numeric
)
returns integer language sql immutable as $$
  select (case when p_singing is null then 0 else 1 end)
       + (case when p_dancing is null then 0 else 1 end)
       + (case when p_acting is null then 0 else 1 end);
$$;

create or replace function assert_rating_scores(
  p_singing numeric,
  p_dancing numeric,
  p_acting numeric
)
returns void language plpgsql as $$
begin
  if rating_score_count(p_singing, p_dancing, p_acting) < 2 then
    raise exception '至少需要完成两个维度评分';
  end if;
end;
$$;

create or replace function get_rating_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with per_user_role as (
    select
      coalesce(user_id::text, 'anonymous:' || anonymous_user_id) as voter_key,
      actor_id,
      musical_id,
      role_id,
      round(avg(singing_score) filter (where singing_score is not null), 2) as singing_avg,
      round(avg(dancing_score) filter (where dancing_score is not null), 2) as dancing_avg,
      round(avg(acting_score) filter (where acting_score is not null), 2) as acting_avg
    from ratings
    where musical_id is not null and role_id is not null
    group by coalesce(user_id::text, 'anonymous:' || anonymous_user_id), actor_id, musical_id, role_id
  ),
  per_user_manual_subject as (
    select
      coalesce(user_id::text, 'anonymous:' || anonymous_user_id) as voter_key,
      actor_id,
      round(avg(singing_score) filter (where singing_score is not null), 2) as singing_avg,
      round(avg(dancing_score) filter (where dancing_score is not null), 2) as dancing_avg,
      round(avg(acting_score) filter (where acting_score is not null), 2) as acting_avg
    from ratings
    where manual_musical_name is not null and manual_role_name is not null
    group by coalesce(user_id::text, 'anonymous:' || anonymous_user_id), actor_id,
             lower(manual_musical_name), lower(manual_role_name)
  ),
  per_user_actor as (
    select
      voter_key,
      actor_id,
      round(avg(singing_avg) filter (where singing_avg is not null), 2) as singing_avg,
      round(avg(dancing_avg) filter (where dancing_avg is not null), 2) as dancing_avg,
      round(avg(acting_avg) filter (where acting_avg is not null), 2) as acting_avg
    from (
      select voter_key, actor_id, singing_avg, dancing_avg, acting_avg from per_user_role
      union all
      select voter_key, actor_id, singing_avg, dancing_avg, acting_avg from per_user_manual_subject
    ) subjects
    group by voter_key, actor_id
  ),
  actor_summary as (
    select
      actor_id,
      count(*)::integer as user_count,
      round(avg(singing_avg) filter (where singing_avg is not null), 2) as singing_avg,
      round(avg(dancing_avg) filter (where dancing_avg is not null), 2) as dancing_avg,
      round(avg(acting_avg) filter (where acting_avg is not null), 2) as acting_avg
    from per_user_actor
    group by actor_id
    having count(*) >= 10
  ),
  role_summary as (
    select
      actor_id,
      musical_id,
      role_id,
      count(*)::integer as user_count,
      round(avg(singing_avg) filter (where singing_avg is not null), 2) as singing_avg,
      round(avg(dancing_avg) filter (where dancing_avg is not null), 2) as dancing_avg,
      round(avg(acting_avg) filter (where acting_avg is not null), 2) as acting_avg
    from per_user_role
    group by actor_id, musical_id, role_id
    having count(*) >= 10
  )
  select jsonb_build_object(
    'actors', coalesce((select jsonb_agg(to_jsonb(actor_summary) order by actor_id) from actor_summary), '[]'::jsonb),
    'roles', coalesce((select jsonb_agg(to_jsonb(role_summary) order by actor_id, musical_id, role_id) from role_summary), '[]'::jsonb)
  );
$$;

create or replace function get_my_rating(
  p_anonymous_user_id text default null,
  p_performance_id integer default null,
  p_actor_id integer default null,
  p_musical_id integer default null,
  p_role_id integer default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(r)
  from (
    select singing_score, dancing_score, acting_score, updated_at
    from ratings
    where actor_id = p_actor_id
      and musical_id = p_musical_id
      and role_id = p_role_id
      and performance_id = p_performance_id
      and (
        (auth.uid() is not null and user_id = auth.uid())
        or (auth.uid() is null and user_id is null and anonymous_user_id = p_anonymous_user_id)
      )
    order by updated_at desc
    limit 1
  ) r;
$$;

-- 读取用户在评分时选择的具体演出场次。
-- 上游排期偶尔只提供卡司、未提供角色；这类场次仍应可供评分，
-- 只将 role_confirmed 标为 false，避免把“角色未标注”误判成“没有排期”。
create or replace function get_rating_performances(
  p_actor_id integer,
  p_musical_id integer,
  p_role_id integer,
  p_date date
)
returns table (
  id integer,
  date date,
  "time" text,
  city text,
  theatre text,
  role_confirmed boolean,
  "cast" jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with subject as (
    select m.name as musical_name, r.name as role_name
    from musicals m
    join roles r on r.id = p_role_id and r.musical_id = m.id
    join actor_roles ar on ar.actor_id = p_actor_id
                       and ar.musical_id = m.id
                       and ar.role_id = r.id
    where m.id = p_musical_id
  )
  select
    s.id,
    s.date,
    s.time as "time",
    s.city,
    s.theatre,
    coalesce(nullif(btrim(sc.role), '') = subject.role_name, false) as role_confirmed,
    jsonb_build_array(jsonb_build_object(
      'actor_id', sc.artist_id,
      'actor_name', a.name,
      'role_name', coalesce(nullif(btrim(sc.role), ''), subject.role_name)
    )) as "cast"
  from subject
  join shows s on s.date = p_date
             and lower(btrim(s.musical)) = lower(btrim(subject.musical_name))
  join show_casts sc on sc.show_id = s.id and sc.artist_id = p_actor_id
  join artists a on a.id = sc.artist_id
  order by s.time nulls last, s.id;
$$;

drop function if exists get_my_manual_rating(text, integer, text, text);

create function get_my_manual_rating(
  p_anonymous_user_id text default null,
  p_actor_id integer default null,
  p_musical_name text default null,
  p_role_name text default null,
  p_performance_date date default null,
  p_session_period text default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(r)
  from (
    select singing_score, dancing_score, acting_score, updated_at
    from ratings
    where actor_id = p_actor_id
      and lower(manual_musical_name) = lower(p_musical_name)
      and lower(manual_role_name) = lower(p_role_name)
      and performance_date = p_performance_date
      and session_period is not distinct from p_session_period
      and (
        (auth.uid() is not null and user_id = auth.uid())
        or (auth.uid() is null and user_id is null and anonymous_user_id = p_anonymous_user_id)
      )
    order by updated_at desc
    limit 1
  ) r;
$$;

create or replace function upsert_actor_rating(
  p_anonymous_user_id text default null,
  p_performance_id integer default null,
  p_actor_id integer default null,
  p_musical_id integer default null,
  p_role_id integer default null,
  p_performance_date date default null,
  p_session_period text default null,
  p_singing_score numeric default null,
  p_dancing_score numeric default null,
  p_acting_score numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_rating_id bigint;
  v_status text := case when p_performance_id is null then 'pending' else 'confirmed' end;
  v_rating_slot text;
begin
  perform assert_rating_scores(p_singing_score, p_dancing_score, p_acting_score);
  v_rating_slot := case
    when p_performance_id is not null then 'show:' || p_performance_id::text
    when p_performance_date is not null then 'date:' || p_performance_date::text || '|session:' || coalesce(p_session_period, 'unknown')
    else null
  end;
  if v_rating_slot is null then
    raise exception '请选择具体演出场次';
  end if;

  if v_user_id is not null then
    update ratings
    set performance_id = p_performance_id,
        performance_date = p_performance_date,
        session_period = p_session_period,
        singing_score = p_singing_score,
        dancing_score = p_dancing_score,
        acting_score = p_acting_score,
        cast_mapping_status = v_status
    where user_id = v_user_id
      and actor_id = p_actor_id
      and musical_id = p_musical_id
      and role_id = p_role_id
      and rating_slot = v_rating_slot
    returning id into v_rating_id;

    if v_rating_id is null then
      insert into ratings(user_id, actor_id, musical_id, role_id, performance_id, performance_date, session_period, rating_slot, singing_score, dancing_score, acting_score, cast_mapping_status)
      values (v_user_id, p_actor_id, p_musical_id, p_role_id, p_performance_id, p_performance_date, p_session_period, v_rating_slot, p_singing_score, p_dancing_score, p_acting_score, v_status)
      returning id into v_rating_id;
    end if;
  else
    if p_anonymous_user_id is null or p_anonymous_user_id = '' then
      raise exception '匿名评分缺少客户端标识';
    end if;

    update ratings
    set performance_id = p_performance_id,
        performance_date = p_performance_date,
        session_period = p_session_period,
        singing_score = p_singing_score,
        dancing_score = p_dancing_score,
        acting_score = p_acting_score,
        cast_mapping_status = v_status
    where user_id is null
      and anonymous_user_id = p_anonymous_user_id
      and actor_id = p_actor_id
      and musical_id = p_musical_id
      and role_id = p_role_id
      and rating_slot = v_rating_slot
    returning id into v_rating_id;

    if v_rating_id is null then
      insert into ratings(anonymous_user_id, actor_id, musical_id, role_id, performance_id, performance_date, session_period, rating_slot, singing_score, dancing_score, acting_score, cast_mapping_status)
      values (p_anonymous_user_id, p_actor_id, p_musical_id, p_role_id, p_performance_id, p_performance_date, p_session_period, v_rating_slot, p_singing_score, p_dancing_score, p_acting_score, v_status)
      returning id into v_rating_id;
    end if;
  end if;

  return jsonb_build_object('id', v_rating_id, 'cast_mapping_status', v_status);
end;
$$;

create or replace function upsert_manual_actor_rating(
  p_anonymous_user_id text default null,
  p_actor_id integer default null,
  p_musical_name text default null,
  p_role_name text default null,
  p_performance_date date default null,
  p_session_period text default null,
  p_singing_score numeric default null,
  p_dancing_score numeric default null,
  p_acting_score numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_rating_id bigint;
  v_rating_slot text;
begin
  perform assert_rating_scores(p_singing_score, p_dancing_score, p_acting_score);
  if p_performance_date is null then
    raise exception '请选择观看日期';
  end if;
  v_rating_slot := 'date:' || p_performance_date::text || '|session:' || coalesce(p_session_period, 'unknown');

  if v_user_id is not null then
    update ratings
    set performance_date = p_performance_date,
        session_period = p_session_period,
        singing_score = p_singing_score,
        dancing_score = p_dancing_score,
        acting_score = p_acting_score,
        cast_mapping_status = 'manual'
    where user_id = v_user_id
      and actor_id = p_actor_id
      and lower(manual_musical_name) = lower(p_musical_name)
      and lower(manual_role_name) = lower(p_role_name)
      and rating_slot = v_rating_slot
    returning id into v_rating_id;

    if v_rating_id is null then
      insert into ratings(user_id, actor_id, manual_musical_name, manual_role_name, performance_date, session_period, rating_slot, singing_score, dancing_score, acting_score, cast_mapping_status)
      values (v_user_id, p_actor_id, p_musical_name, p_role_name, p_performance_date, p_session_period, v_rating_slot, p_singing_score, p_dancing_score, p_acting_score, 'manual')
      returning id into v_rating_id;
    end if;
  else
    if p_anonymous_user_id is null or p_anonymous_user_id = '' then
      raise exception '匿名评分缺少客户端标识';
    end if;

    update ratings
    set performance_date = p_performance_date,
        session_period = p_session_period,
        singing_score = p_singing_score,
        dancing_score = p_dancing_score,
        acting_score = p_acting_score,
        cast_mapping_status = 'manual'
    where user_id is null
      and anonymous_user_id = p_anonymous_user_id
      and actor_id = p_actor_id
      and lower(manual_musical_name) = lower(p_musical_name)
      and lower(manual_role_name) = lower(p_role_name)
      and rating_slot = v_rating_slot
    returning id into v_rating_id;

    if v_rating_id is null then
      insert into ratings(anonymous_user_id, actor_id, manual_musical_name, manual_role_name, performance_date, session_period, rating_slot, singing_score, dancing_score, acting_score, cast_mapping_status)
      values (p_anonymous_user_id, p_actor_id, p_musical_name, p_role_name, p_performance_date, p_session_period, v_rating_slot, p_singing_score, p_dancing_score, p_acting_score, 'manual')
      returning id into v_rating_id;
    end if;
  end if;

  return jsonb_build_object('id', v_rating_id, 'cast_mapping_status', 'manual');
end;
$$;

-- 新增场次字段时，PostgreSQL 不能直接替换 table return 类型，先删除旧函数。
drop function if exists get_my_ratings();

create function get_my_ratings()
returns table (
  id bigint,
  actor_id integer,
  actor_name text,
  musical_id integer,
  musical_name text,
  role_id integer,
  role_name text,
  manual_musical_name text,
  manual_role_name text,
  performance_id integer,
  performance_date date,
  session_period text,
  singing_score numeric,
  dancing_score numeric,
  acting_score numeric,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.actor_id,
    a.name as actor_name,
    r.musical_id,
    m.name as musical_name,
    r.role_id,
    ro.name as role_name,
    r.manual_musical_name,
    r.manual_role_name,
    r.performance_id,
    r.performance_date,
    r.session_period,
    r.singing_score,
    r.dancing_score,
    r.acting_score,
    r.updated_at
  from ratings r
  join artists a on a.id = r.actor_id
  left join musicals m on m.id = r.musical_id
  left join roles ro on ro.id = r.role_id
  where auth.uid() is not null
    and r.user_id = auth.uid()
  order by r.updated_at desc;
$$;

-- 登录后认领当前浏览器此前留下的匿名评分。
-- 这不是硬件设备指纹：p_anonymous_user_id 只是浏览器 localStorage 中随机生成的本地标识。
-- 若账号和匿名记录恰好是同一评分对象、同一场次，保留更新时间较晚的一份，避免重复计票。
create or replace function claim_anonymous_ratings(
  p_anonymous_user_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_anonymous_rating ratings%rowtype;
  v_account_rating ratings%rowtype;
  v_claimed_count integer := 0;
begin
  if v_user_id is null then
    raise exception '请先登录后再认领匿名评分';
  end if;
  if p_anonymous_user_id is null or btrim(p_anonymous_user_id) = '' then
    raise exception '匿名评分缺少客户端标识';
  end if;

  for v_anonymous_rating in
    select *
    from ratings
    where user_id is null
      and anonymous_user_id = p_anonymous_user_id
    order by id
    for update
  loop
    select * into v_account_rating
    from ratings
    where user_id = v_user_id
      and rating_slot = v_anonymous_rating.rating_slot
      and (
        (
          v_anonymous_rating.musical_id is not null
          and musical_id = v_anonymous_rating.musical_id
          and role_id = v_anonymous_rating.role_id
          and actor_id = v_anonymous_rating.actor_id
        )
        or (
          v_anonymous_rating.manual_musical_name is not null
          and manual_musical_name is not null
          and actor_id = v_anonymous_rating.actor_id
          and lower(manual_musical_name) = lower(v_anonymous_rating.manual_musical_name)
          and lower(manual_role_name) = lower(v_anonymous_rating.manual_role_name)
        )
      )
    for update;

    if found then
      if v_anonymous_rating.updated_at > v_account_rating.updated_at then
        update ratings
        set performance_id = v_anonymous_rating.performance_id,
            performance_date = v_anonymous_rating.performance_date,
            session_period = v_anonymous_rating.session_period,
            singing_score = v_anonymous_rating.singing_score,
            dancing_score = v_anonymous_rating.dancing_score,
            acting_score = v_anonymous_rating.acting_score,
            cast_mapping_status = v_anonymous_rating.cast_mapping_status
        where id = v_account_rating.id;
      end if;
      delete from ratings where id = v_anonymous_rating.id;
    else
      update ratings
      set user_id = v_user_id,
          anonymous_user_id = null
      where id = v_anonymous_rating.id;
    end if;

    v_claimed_count := v_claimed_count + 1;
  end loop;

  return jsonb_build_object('claimed_count', v_claimed_count);
end;
$$;

-- Functions execute with the table owner's privileges so that aggregate and
-- anonymous ratings can remain protected by RLS. Supabase/Postgres grants
-- EXECUTE to public by default; revoke that broad grant explicitly.
revoke all on function get_rating_summary() from public;
revoke all on function get_my_rating(text, integer, integer, integer, integer) from public;
revoke all on function get_rating_performances(integer, integer, integer, date) from public;
revoke all on function get_my_manual_rating(text, integer, text, text, date, text) from public;
revoke all on function upsert_actor_rating(text, integer, integer, integer, integer, date, text, numeric, numeric, numeric) from public;
revoke all on function upsert_manual_actor_rating(text, integer, text, text, date, text, numeric, numeric, numeric) from public;
revoke all on function get_my_ratings() from public;
revoke all on function claim_anonymous_ratings(text) from public;

grant execute on function get_rating_summary() to anon, authenticated;
grant execute on function get_my_rating(text, integer, integer, integer, integer) to anon, authenticated;
grant execute on function get_rating_performances(integer, integer, integer, date) to anon, authenticated;
grant execute on function get_my_manual_rating(text, integer, text, text, date, text) to anon, authenticated;
grant execute on function upsert_actor_rating(text, integer, integer, integer, integer, date, text, numeric, numeric, numeric) to anon, authenticated;
grant execute on function upsert_manual_actor_rating(text, integer, text, text, date, text, numeric, numeric, numeric) to anon, authenticated;
grant execute on function get_my_ratings() to authenticated;
grant execute on function claim_anonymous_ratings(text) to authenticated;
