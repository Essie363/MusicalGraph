-- 评分公开门槛与未解锁人数展示
-- 执行位置：Supabase SQL Editor
-- 已启用评分风控的线上项目执行此文件即可；可重复执行。
-- 规则：1–4 人只返回参与人数；5–9 人公开评分；10 人起视为稳定样本。

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
      case when count(*) >= 5 then round(avg(singing_avg) filter (where singing_avg is not null), 2) end as singing_avg,
      case when count(*) >= 5 then round(avg(dancing_avg) filter (where dancing_avg is not null), 2) end as dancing_avg,
      case when count(*) >= 5 then round(avg(acting_avg) filter (where acting_avg is not null), 2) end as acting_avg
    from per_user_actor
    group by actor_id
  ),
  role_summary as (
    select
      actor_id,
      musical_id,
      role_id,
      count(*)::integer as user_count,
      case when count(*) >= 5 then round(avg(singing_avg) filter (where singing_avg is not null), 2) end as singing_avg,
      case when count(*) >= 5 then round(avg(dancing_avg) filter (where dancing_avg is not null), 2) end as dancing_avg,
      case when count(*) >= 5 then round(avg(acting_avg) filter (where acting_avg is not null), 2) end as acting_avg
    from per_user_role
    group by actor_id, musical_id, role_id
  )
  select jsonb_build_object(
    'actors', coalesce((select jsonb_agg(to_jsonb(actor_summary) order by actor_id) from actor_summary), '[]'::jsonb),
    'roles', coalesce((select jsonb_agg(to_jsonb(role_summary) order by actor_id, musical_id, role_id) from role_summary), '[]'::jsonb)
  );
$$;

revoke all on function get_rating_summary() from public;
grant execute on function get_rating_summary() to anon, authenticated;
