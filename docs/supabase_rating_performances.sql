-- 补齐线上评分场次读取 RPC
-- 适用对象：已经执行过 docs/supabase_auth_ratings.sql，但页面提示
-- “暂未能读取当天排期”的项目。
-- 可重复执行，不修改任何已有评分记录。

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
    join actor_roles ar on ar.artist_id = p_actor_id
                       and ar.musical_id = m.id
                       and ar.role_id = r.id
    where m.id = p_musical_id
  )
  select
    s.id,
    s.date::date as date,
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
  join shows s on s.date = p_date::text
             and lower(btrim(s.musical)) = lower(btrim(subject.musical_name))
  join show_casts sc on sc.show_id = s.id and sc.artist_id = p_actor_id
  join artists a on a.id = sc.artist_id
  order by s.time nulls last, s.id;
$$;

revoke all on function get_rating_performances(integer, integer, integer, date) from public;
grant execute on function get_rating_performances(integer, integer, integer, date) to anon, authenticated;
