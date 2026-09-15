-- Cast Light 评分风控 V1
-- 执行位置：Supabase SQL Editor
-- 前置条件：已执行 docs/supabase_auth_ratings.sql。
--
-- 设计：正常用户一人一票；疑似异常评分保留在“我的评分”中，
-- 但不参与公开汇总。当前静态站直连 Supabase，无法取得可信 IP，
-- 因此本版不记录 IP 或 IP hash，避免制造看似有效但实际不可靠的规则。

-- 1. 风控状态、浏览器设备标识和风险原因。历史评分不受影响。
alter table ratings add column if not exists device_id text;
alter table ratings add column if not exists risk_status text not null default 'normal'
  check (risk_status in ('normal', 'suspicious', 'blocked'));
alter table ratings add column if not exists risk_reason jsonb not null default '[]'::jsonb;

update ratings
set risk_status = coalesce(risk_status, 'normal'),
    risk_reason = coalesce(risk_reason, '[]'::jsonb)
where risk_status is null or risk_reason is null;

-- 早期评分只保存了 performance_id。回填对应场次日期，避免“我的评分”误显示场次待补充。
-- 真实场次的“午 / 夕 / 晚场”以 shows.time 为唯一来源。
-- 统一在数据库判断，避免前端和迁移脚本采用不同的分界规则。
create or replace function rating_session_from_show_time(p_time text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when lower(coalesce(p_time, '')) ~ '(晚|夜|night)' then 'night'
    when lower(coalesce(p_time, '')) ~ '(夕|傍晚|黄昏)' then 'evening'
    when lower(coalesce(p_time, '')) ~ '(^|[^0-9])(0?[0-9]|1[0-5])(:[0-9]{2})?([^0-9]|$)' then 'matinee'
    when lower(coalesce(p_time, '')) ~ '(^|[^0-9])(1[6-7])(:[0-9]{2})?([^0-9]|$)' then 'evening'
    when lower(coalesce(p_time, '')) ~ '(^|[^0-9])(1[8-9]|2[0-3])(:[0-9]{2})?([^0-9]|$)' then 'night'
    else null
  end;
$$;

-- 回填早期评分的场次日期，并修复历史上被错误归为“夕场”的午场记录。
update ratings r
set performance_date = case
      when coalesce(s.date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then s.date::date
      else r.performance_date
    end,
    session_period = coalesce(rating_session_from_show_time(s.time), r.session_period)
from shows s
where r.performance_id = s.id
  and (
    r.performance_date is null
    or (
      rating_session_from_show_time(s.time) is not null
      and r.session_period is distinct from rating_session_from_show_time(s.time)
    )
  );

-- 所有阈值集中在这一行，后续只需 update 本表即可调整，不要改业务函数。
create table if not exists rating_risk_config (
  singleton boolean primary key default true check (singleton),
  five_minute_limit integer not null default 10 check (five_minute_limit > 0),
  five_minute_window_minutes integer not null default 5 check (five_minute_window_minutes > 0),
  hourly_limit integer not null default 30 check (hourly_limit > 0),
  hourly_window_minutes integer not null default 60 check (hourly_window_minutes > 0),
  daily_limit integer not null default 100 check (daily_limit > 0),
  daily_window_hours integer not null default 24 check (daily_window_hours > 0),
  device_account_limit integer not null default 3 check (device_account_limit > 1),
  device_window_hours integer not null default 24 check (device_window_hours > 0),
  role_burst_limit integer not null default 10 check (role_burst_limit > 1),
  role_burst_window_minutes integer not null default 60 check (role_burst_window_minutes > 0),
  new_account_window_hours integer not null default 24 check (new_account_window_hours > 0),
  new_account_ratio_min numeric(4,3) not null default 0.700 check (new_account_ratio_min between 0 and 1),
  extreme_ratio_min numeric(4,3) not null default 0.800 check (extreme_ratio_min between 0 and 1),
  high_score_min numeric(3,1) not null default 4.5 check (high_score_min between 0.5 and 5),
  low_score_max numeric(3,1) not null default 1.5 check (low_score_max between 0.5 and 5),
  updated_at timestamptz not null default now()
);

insert into rating_risk_config (singleton)
values (true)
on conflict (singleton) do nothing;

-- 每次提交都有一条事件，用于计算频率；风险状态变化另存日志，便于人工复核。
create table if not exists rating_risk_events (
  id bigserial primary key,
  rating_id bigint not null references ratings(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  anonymous_user_id text,
  device_id text,
  risk_status text not null default 'normal' check (risk_status in ('normal', 'suspicious', 'blocked')),
  risk_reason jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_rating_risk_events_user_time
  on rating_risk_events(user_id, created_at desc) where user_id is not null;
create index if not exists idx_rating_risk_events_anon_time
  on rating_risk_events(anonymous_user_id, created_at desc) where anonymous_user_id is not null;
create index if not exists idx_rating_risk_events_device_time
  on rating_risk_events(device_id, created_at desc) where device_id is not null;
create index if not exists idx_rating_risk_events_rating
  on rating_risk_events(rating_id);

create table if not exists rating_risk_logs (
  id bigserial primary key,
  rating_id bigint not null references ratings(id) on delete cascade,
  previous_risk_status text not null,
  risk_status text not null,
  risk_reason jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_rating_risk_logs_rating_time
  on rating_risk_logs(rating_id, created_at desc);

alter table rating_risk_config enable row level security;
alter table rating_risk_events enable row level security;
alter table rating_risk_logs enable row level security;

-- 仅内部风控函数调用：保留 blocked，不自动解除已有 suspicious 状态。
create or replace function mark_rating_suspicious(
  p_rating_id bigint,
  p_reasons jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous text;
begin
  select risk_status into v_previous
  from ratings
  where id = p_rating_id
  for update;

  if v_previous is null or v_previous = 'blocked' then
    return;
  end if;

  update ratings
  set risk_status = 'suspicious',
      risk_reason = coalesce(risk_reason, '[]'::jsonb) || coalesce(p_reasons, '[]'::jsonb)
  where id = p_rating_id;

  if v_previous = 'normal' then
    insert into rating_risk_logs(rating_id, previous_risk_status, risk_status, risk_reason)
    values (p_rating_id, 'normal', 'suspicious', coalesce(p_reasons, '[]'::jsonb));
  end if;
end;
$$;

-- 评分写入后进行风控。任何风险命中都只标记，不阻断评分保存。
create or replace function apply_rating_risk(p_rating_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rating ratings%rowtype;
  v_config rating_risk_config%rowtype;
  v_event_id bigint;
  v_count integer;
  v_burst_users integer := 0;
  v_new_account_ratio numeric := 0;
  v_high_ratio numeric := 0;
  v_low_ratio numeric := 0;
  v_device_overlap boolean := false;
  v_burst_conditions integer := 0;
  v_reasons jsonb := '[]'::jsonb;
  v_candidate_id bigint;
begin
  select * into strict v_rating from ratings where id = p_rating_id;
  select * into strict v_config from rating_risk_config where singleton = true;

  insert into rating_risk_events(rating_id, user_id, anonymous_user_id, device_id)
  values (v_rating.id, v_rating.user_id, v_rating.anonymous_user_id, nullif(v_rating.device_id, ''))
  returning id into v_event_id;

  -- 同一账号或匿名浏览器短时间大量提交：允许前 10/30/100 次，之后标记。
  select count(*) into v_count
  from rating_risk_events e
  where e.created_at >= now() - make_interval(mins => v_config.five_minute_window_minutes)
    and (
      (v_rating.user_id is not null and e.user_id = v_rating.user_id)
      or (v_rating.user_id is null and e.user_id is null and e.anonymous_user_id = v_rating.anonymous_user_id)
    );
  if v_count > v_config.five_minute_limit then
    v_reasons := v_reasons || jsonb_build_array('high_frequency_5m');
  end if;

  select count(*) into v_count
  from rating_risk_events e
  where e.created_at >= now() - make_interval(mins => v_config.hourly_window_minutes)
    and (
      (v_rating.user_id is not null and e.user_id = v_rating.user_id)
      or (v_rating.user_id is null and e.user_id is null and e.anonymous_user_id = v_rating.anonymous_user_id)
    );
  if v_count > v_config.hourly_limit then
    v_reasons := v_reasons || jsonb_build_array('high_frequency_1h');
  end if;

  select count(*) into v_count
  from rating_risk_events e
  where e.created_at >= now() - make_interval(hours => v_config.daily_window_hours)
    and (
      (v_rating.user_id is not null and e.user_id = v_rating.user_id)
      or (v_rating.user_id is null and e.user_id is null and e.anonymous_user_id = v_rating.anonymous_user_id)
    );
  if v_count > v_config.daily_limit then
    v_reasons := v_reasons || jsonb_build_array('high_frequency_24h');
  end if;

  -- 同一浏览器 24 小时内第 3 个参与评分的账号开始暂不计入公开分数。
  if v_rating.user_id is not null and nullif(v_rating.device_id, '') is not null then
    select count(distinct e.user_id) into v_count
    from rating_risk_events e
    where e.device_id = v_rating.device_id
      and e.user_id is not null
      and e.created_at >= now() - make_interval(hours => v_config.device_window_hours);
    if v_count >= v_config.device_account_limit then
      v_reasons := v_reasons || jsonb_build_array('multi_account_device');
    end if;
  end if;

  -- 已知“演员 × 剧目 × 角色”在短时间内集中出现评分时，再结合两项辅助信号判断。
  if v_rating.musical_id is not null and v_rating.role_id is not null then
    with window_ratings as (
      select distinct r.id, r.user_id, r.anonymous_user_id, r.device_id,
        (coalesce(r.singing_score, 0) + coalesce(r.dancing_score, 0) + coalesce(r.acting_score, 0)) /
        nullif(
          (case when r.singing_score is null then 0 else 1 end) +
          (case when r.dancing_score is null then 0 else 1 end) +
          (case when r.acting_score is null then 0 else 1 end),
          0
        ) as overall_score
      from rating_risk_events e
      join ratings r on r.id = e.rating_id
      where e.created_at >= now() - make_interval(mins => v_config.role_burst_window_minutes)
        and r.actor_id = v_rating.actor_id
        and r.musical_id = v_rating.musical_id
        and r.role_id = v_rating.role_id
    ), per_user as (
      select
        coalesce(user_id::text, 'anonymous:' || anonymous_user_id) as voter_key,
        user_id,
        avg(overall_score) as overall_score
      from window_ratings
      group by coalesce(user_id::text, 'anonymous:' || anonymous_user_id), user_id
    )
    select
      count(*)::integer,
      coalesce(avg(case when au.id is not null and au.created_at >= now() - make_interval(hours => v_config.new_account_window_hours) then 1::numeric else 0::numeric end), 0),
      coalesce(avg(case when overall_score >= v_config.high_score_min then 1::numeric else 0::numeric end), 0),
      coalesce(avg(case when overall_score <= v_config.low_score_max then 1::numeric else 0::numeric end), 0)
    into v_burst_users, v_new_account_ratio, v_high_ratio, v_low_ratio
    from per_user pu
    left join auth.users au on au.id = pu.user_id;

    select exists (
      select 1
      from rating_risk_events e
      join ratings r on r.id = e.rating_id
      where e.created_at >= now() - make_interval(mins => v_config.role_burst_window_minutes)
        and r.actor_id = v_rating.actor_id
        and r.musical_id = v_rating.musical_id
        and r.role_id = v_rating.role_id
        and nullif(e.device_id, '') is not null
      group by e.device_id
      having count(distinct coalesce(r.user_id::text, 'anonymous:' || r.anonymous_user_id)) > 1
    ) into v_device_overlap;

    if v_burst_users >= v_config.role_burst_limit then
      if v_new_account_ratio >= v_config.new_account_ratio_min then
        v_burst_conditions := v_burst_conditions + 1;
        v_reasons := v_reasons || jsonb_build_array('new_account_burst');
      end if;
      if v_high_ratio >= v_config.extreme_ratio_min then
        v_burst_conditions := v_burst_conditions + 1;
        v_reasons := v_reasons || jsonb_build_array('extreme_high_burst');
      end if;
      if v_low_ratio >= v_config.extreme_ratio_min then
        v_burst_conditions := v_burst_conditions + 1;
        v_reasons := v_reasons || jsonb_build_array('extreme_low_burst');
      end if;
      if v_device_overlap then
        v_burst_conditions := v_burst_conditions + 1;
        v_reasons := v_reasons || jsonb_build_array('device_overlap_burst');
      end if;

      if v_burst_conditions >= 2 then
        v_reasons := v_reasons || jsonb_build_array('rating_burst');
        -- 只处理当前异常窗口中的评分，不动窗口外的历史正常评分。
        for v_candidate_id in
          select distinct r.id
          from rating_risk_events e
          join ratings r on r.id = e.rating_id
          where e.created_at >= now() - make_interval(mins => v_config.role_burst_window_minutes)
            and r.actor_id = v_rating.actor_id
            and r.musical_id = v_rating.musical_id
            and r.role_id = v_rating.role_id
        loop
          perform mark_rating_suspicious(v_candidate_id, v_reasons);
        end loop;
      end if;
    end if;
  end if;

  if jsonb_array_length(v_reasons) > 0 then
    perform mark_rating_suspicious(v_rating.id, v_reasons);
  end if;

  update rating_risk_events e
  set risk_status = r.risk_status,
      risk_reason = coalesce(r.risk_reason, '[]'::jsonb)
  from ratings r
  where e.id = v_event_id and r.id = e.rating_id;

  return (
    select jsonb_build_object('risk_status', risk_status, 'risk_reason', risk_reason)
    from ratings where id = v_rating.id
  );
end;
$$;

-- 2. 公开汇总只使用 normal 评分；“我的评分”仍会读取所有本人记录。
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
      and risk_status = 'normal'
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
      and risk_status = 'normal'
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

-- 3. 评分写入函数增加 p_device_id，并在保存成功后调用风控。
drop function if exists upsert_actor_rating(text, integer, integer, integer, integer, date, text, numeric, numeric, numeric);

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
  p_acting_score numeric default null,
  p_device_id text default null
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
  v_performance_date date := p_performance_date;
  v_session_period text := p_session_period;
  v_risk jsonb;
begin
  perform assert_rating_scores(p_singing_score, p_dancing_score, p_acting_score);
  if p_performance_id is not null then
    select case
             when coalesce(s.date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then s.date::date
             else null
           end,
           coalesce(rating_session_from_show_time(s.time), nullif(v_session_period, ''))
    into v_performance_date, v_session_period
    from shows s
    where s.id = p_performance_id;
    if v_performance_date is null then
      raise exception '未找到所选演出场次';
    end if;
  end if;
  v_rating_slot := case
    when p_performance_id is not null then 'show:' || p_performance_id::text
    when v_performance_date is not null then 'date:' || v_performance_date::text || '|session:' || coalesce(v_session_period, 'unknown')
    else null
  end;
  if v_rating_slot is null then
    raise exception '请选择具体演出场次';
  end if;

  if v_user_id is not null then
    update ratings
    set performance_id = p_performance_id,
        performance_date = v_performance_date,
        session_period = v_session_period,
        singing_score = p_singing_score,
        dancing_score = p_dancing_score,
        acting_score = p_acting_score,
        cast_mapping_status = v_status,
        device_id = nullif(p_device_id, '')
    where user_id = v_user_id and actor_id = p_actor_id and musical_id = p_musical_id
      and role_id = p_role_id and rating_slot = v_rating_slot
    returning id into v_rating_id;

    if v_rating_id is null then
      insert into ratings(user_id, actor_id, musical_id, role_id, performance_id, performance_date, session_period, rating_slot, singing_score, dancing_score, acting_score, cast_mapping_status, device_id)
      values (v_user_id, p_actor_id, p_musical_id, p_role_id, p_performance_id, v_performance_date, v_session_period, v_rating_slot, p_singing_score, p_dancing_score, p_acting_score, v_status, nullif(p_device_id, ''))
      returning id into v_rating_id;
    end if;
  else
    if p_anonymous_user_id is null or p_anonymous_user_id = '' then
      raise exception '匿名评分缺少客户端标识';
    end if;

    update ratings
    set performance_id = p_performance_id,
        performance_date = v_performance_date,
        session_period = v_session_period,
        singing_score = p_singing_score,
        dancing_score = p_dancing_score,
        acting_score = p_acting_score,
        cast_mapping_status = v_status,
        device_id = nullif(p_device_id, '')
    where user_id is null and anonymous_user_id = p_anonymous_user_id
      and actor_id = p_actor_id and musical_id = p_musical_id
      and role_id = p_role_id and rating_slot = v_rating_slot
    returning id into v_rating_id;

    if v_rating_id is null then
      insert into ratings(anonymous_user_id, actor_id, musical_id, role_id, performance_id, performance_date, session_period, rating_slot, singing_score, dancing_score, acting_score, cast_mapping_status, device_id)
      values (p_anonymous_user_id, p_actor_id, p_musical_id, p_role_id, p_performance_id, v_performance_date, v_session_period, v_rating_slot, p_singing_score, p_dancing_score, p_acting_score, v_status, nullif(p_device_id, ''))
      returning id into v_rating_id;
    end if;
  end if;

  v_risk := apply_rating_risk(v_rating_id);
  return jsonb_build_object('id', v_rating_id, 'cast_mapping_status', v_status, 'risk_status', v_risk->>'risk_status');
end;
$$;

drop function if exists upsert_manual_actor_rating(text, integer, text, text, date, text, numeric, numeric, numeric);

create or replace function upsert_manual_actor_rating(
  p_anonymous_user_id text default null,
  p_actor_id integer default null,
  p_musical_name text default null,
  p_role_name text default null,
  p_performance_date date default null,
  p_session_period text default null,
  p_singing_score numeric default null,
  p_dancing_score numeric default null,
  p_acting_score numeric default null,
  p_device_id text default null
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
  v_risk jsonb;
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
        cast_mapping_status = 'manual',
        device_id = nullif(p_device_id, '')
    where user_id = v_user_id and actor_id = p_actor_id
      and lower(manual_musical_name) = lower(p_musical_name)
      and lower(manual_role_name) = lower(p_role_name)
      and rating_slot = v_rating_slot
    returning id into v_rating_id;

    if v_rating_id is null then
      insert into ratings(user_id, actor_id, manual_musical_name, manual_role_name, performance_date, session_period, rating_slot, singing_score, dancing_score, acting_score, cast_mapping_status, device_id)
      values (v_user_id, p_actor_id, p_musical_name, p_role_name, p_performance_date, p_session_period, v_rating_slot, p_singing_score, p_dancing_score, p_acting_score, 'manual', nullif(p_device_id, ''))
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
        cast_mapping_status = 'manual',
        device_id = nullif(p_device_id, '')
    where user_id is null and anonymous_user_id = p_anonymous_user_id
      and actor_id = p_actor_id
      and lower(manual_musical_name) = lower(p_musical_name)
      and lower(manual_role_name) = lower(p_role_name)
      and rating_slot = v_rating_slot
    returning id into v_rating_id;

    if v_rating_id is null then
      insert into ratings(anonymous_user_id, actor_id, manual_musical_name, manual_role_name, performance_date, session_period, rating_slot, singing_score, dancing_score, acting_score, cast_mapping_status, device_id)
      values (p_anonymous_user_id, p_actor_id, p_musical_name, p_role_name, p_performance_date, p_session_period, v_rating_slot, p_singing_score, p_dancing_score, p_acting_score, 'manual', nullif(p_device_id, ''))
      returning id into v_rating_id;
    end if;
  end if;

  v_risk := apply_rating_risk(v_rating_id);
  return jsonb_build_object('id', v_rating_id, 'cast_mapping_status', 'manual', 'risk_status', v_risk->>'risk_status');
end;
$$;

-- 匿名评分登录后仍属于同一个浏览器设备。若同场已有账号评分，保留较新的
-- 评分内容，并把匿名记录的设备标识一并带到账号记录上。
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
            cast_mapping_status = v_anonymous_rating.cast_mapping_status,
            device_id = coalesce(nullif(v_anonymous_rating.device_id, ''), device_id)
        where id = v_account_rating.id;
      else
        update ratings
        set device_id = coalesce(device_id, nullif(v_anonymous_rating.device_id, ''))
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

-- 对外只保留现有的读取/写入 RPC；内部风控函数不能被浏览器直接调用。
revoke all on function mark_rating_suspicious(bigint, jsonb) from public;
revoke all on function apply_rating_risk(bigint) from public;
revoke all on function rating_session_from_show_time(text) from public;
revoke all on function upsert_actor_rating(text, integer, integer, integer, integer, date, text, numeric, numeric, numeric, text) from public;
revoke all on function upsert_manual_actor_rating(text, integer, text, text, date, text, numeric, numeric, numeric, text) from public;

grant execute on function get_rating_summary() to anon, authenticated;
grant execute on function upsert_actor_rating(text, integer, integer, integer, integer, date, text, numeric, numeric, numeric, text) to anon, authenticated;
grant execute on function upsert_manual_actor_rating(text, integer, text, text, date, text, numeric, numeric, numeric, text) to anon, authenticated;

-- 执行后可用以下查询核对：
-- select risk_status, count(*) from ratings group by risk_status order by risk_status;
-- select risk_status, risk_reason, count(*) from rating_risk_events group by risk_status, risk_reason order by count(*) desc;
