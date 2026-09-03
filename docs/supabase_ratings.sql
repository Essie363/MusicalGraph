-- MusicGraph 演员评分系统 V1.1（场次溯源版，Supabase）
-- 在 Supabase SQL Editor 中执行。执行顺序：本文件 -> supabase_rpc_graph.sql。
-- 评分即时生效；场次中缺失的演员-角色对应会单独进入待审核，不阻断评分。

-- show_casts 已有 role 文本字段。role_id 是与 roles / actor_roles 对齐的规范角色。
alter table public.show_casts
  add column if not exists role_id integer references public.roles(id) on delete restrict;

-- 可由旧文本无歧义回填的先回填；其余保持空，交由后续审核或用户补充。
update public.show_casts sc
set role_id = r.id
from public.shows s
join public.musicals m on m.name = s.musical
join public.roles r on r.musical_id = m.id and r.name = sc.role
join public.actor_roles ar on ar.artist_id = sc.artist_id and ar.musical_id = m.id and ar.role_id = r.id
where sc.show_id = s.id
  and sc.role_id is null
  and nullif(trim(sc.role), '') is not null;

-- API 场次通常只提供演员名单。若该演员在该剧只有一个规范角色，则可安全推断并回填。
with inferred_roles as (
  select sc.ctid as cast_row, min(ar.role_id) as role_id
  from public.show_casts sc
  join public.shows s on s.id = sc.show_id
  join public.musicals m on m.name = s.musical
  join public.actor_roles ar on ar.artist_id = sc.artist_id and ar.musical_id = m.id
  where sc.role_id is null
  group by sc.ctid
  having count(distinct ar.role_id) = 1
)
update public.show_casts sc
set role_id = inferred_roles.role_id,
    role = coalesce(nullif(trim(sc.role), ''), (select name from public.roles where id = inferred_roles.role_id))
from inferred_roles
where sc.ctid = inferred_roles.cast_row;

create index if not exists show_casts_show_artist_role_idx
  on public.show_casts (show_id, artist_id, role_id) where role_id is not null;

-- 用户发现“这场由该演员饰演该角色”但系统尚未记录时，保留为独立待审核数据。
create table if not exists public.show_cast_role_submissions (
  id bigint generated always as identity primary key,
  show_id integer not null references public.shows(id) on delete cascade,
  artist_id integer not null references public.artists(id) on delete restrict,
  role_id integer not null references public.roles(id) on delete restrict,
  anonymous_user_id text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint show_cast_role_submissions_user_id_length check (char_length(anonymous_user_id) between 8 and 120),
  unique (show_id, artist_id, role_id)
);
create index if not exists show_cast_role_submissions_status_idx
  on public.show_cast_role_submissions (status, created_at desc);

create table if not exists public.ratings (
  id bigint generated always as identity primary key,
  anonymous_user_id text not null,
  performance_id integer not null references public.shows(id) on delete restrict,
  actor_id integer not null references public.artists(id) on delete restrict,
  musical_id integer not null references public.musicals(id) on delete restrict,
  role_id integer not null references public.roles(id) on delete restrict,
  singing_score numeric(2,1),
  dancing_score numeric(2,1),
  acting_score numeric(2,1),
  status text not null default 'valid' check (status in ('valid', 'pending', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ratings_anonymous_user_id_length check (char_length(anonymous_user_id) between 8 and 120),
  constraint ratings_at_least_two_dimensions check (
    (case when singing_score is null then 0 else 1 end) +
    (case when dancing_score is null then 0 else 1 end) +
    (case when acting_score is null then 0 else 1 end) >= 2
  ),
  constraint ratings_singing_score_range check (singing_score is null or (singing_score between 0.5 and 5.0 and singing_score * 2 = floor(singing_score * 2))),
  constraint ratings_dancing_score_range check (dancing_score is null or (dancing_score between 0.5 and 5.0 and dancing_score * 2 = floor(dancing_score * 2))),
  constraint ratings_acting_score_range check (acting_score is null or (acting_score between 0.5 and 5.0 and acting_score * 2 = floor(acting_score * 2)))
);

-- 兼容已执行过 V1 的项目。历史 V1 记录可暂时为空；V1.1 的 RPC 始终写入 performance_id，且聚合不会纳入旧记录。
alter table public.ratings
  add column if not exists performance_id integer references public.shows(id) on delete restrict;
drop index if exists public.ratings_one_per_user_actor_musical_role;
create unique index if not exists ratings_one_per_user_performance_actor_role
  on public.ratings (anonymous_user_id, performance_id, actor_id, role_id)
  where performance_id is not null;
create index if not exists ratings_actor_valid_idx on public.ratings (actor_id) where status = 'valid' and performance_id is not null;
create index if not exists ratings_role_valid_idx on public.ratings (actor_id, musical_id, role_id) where status = 'valid' and performance_id is not null;
create index if not exists ratings_user_updated_idx on public.ratings (anonymous_user_id, updated_at desc);

create or replace function public.set_rating_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists ratings_set_updated_at on public.ratings;
create trigger ratings_set_updated_at before update on public.ratings
for each row execute function public.set_rating_updated_at();
drop trigger if exists show_cast_role_submissions_set_updated_at on public.show_cast_role_submissions;
create trigger show_cast_role_submissions_set_updated_at before update on public.show_cast_role_submissions
for each row execute function public.set_rating_updated_at();

alter table public.ratings enable row level security;
alter table public.show_cast_role_submissions enable row level security;
revoke all on table public.ratings from anon, authenticated;
revoke all on table public.show_cast_role_submissions from anon, authenticated;

-- 管理员在 Studio 将补充记录改为 approved 时，才写回正式场次卡司。
create or replace function public.apply_approved_show_cast_role_submission()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_role_name text;
begin
  if new.status = 'approved' and old.status <> 'approved' then
    if exists (select 1 from public.show_casts where show_id=new.show_id and artist_id=new.artist_id and role_id is not null and role_id <> new.role_id) then
      raise exception 'confirmed performance cast conflicts with this role submission';
    end if;
    select name into v_role_name from public.roles where id=new.role_id;
    update public.show_casts set role_id=new.role_id, role=coalesce(nullif(role,''),v_role_name)
    where show_id=new.show_id and artist_id=new.artist_id and role_id is null;
    if not exists (select 1 from public.show_casts where show_id=new.show_id and artist_id=new.artist_id and role_id=new.role_id) then
      insert into public.show_casts(show_id,artist_id,role,role_id) values(new.show_id,new.artist_id,v_role_name,new.role_id);
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists show_cast_role_submissions_apply on public.show_cast_role_submissions;
create trigger show_cast_role_submissions_apply before update of status on public.show_cast_role_submissions
for each row execute function public.apply_approved_show_cast_role_submission();

create or replace function public.get_rating_performances(
  p_actor_id integer, p_musical_id integer, p_role_id integer, p_date text
)
returns jsonb language sql security definer set search_path = public stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'date', s.date, 'time', s.time, 'city', s.city, 'theatre', s.theatre,
    'role_confirmed', exists(select 1 from public.show_casts x where x.show_id=s.id and x.artist_id=p_actor_id and x.role_id=p_role_id),
    'cast', coalesce((select jsonb_agg(jsonb_build_object(
      'actor_id', sc.artist_id, 'actor_name', a.name,
      'role_name', coalesce(r.name, nullif(trim(sc.role), ''), '角色待补充')
    ) order by a.name) from public.show_casts sc
      join public.artists a on a.id=sc.artist_id
      left join public.roles r on r.id=sc.role_id
      where sc.show_id=s.id), '[]'::jsonb)
  ) order by coalesce(nullif(s.time,''), '99:99'), '[]'::jsonb)
  from public.shows s
  join public.musicals m on m.name=s.musical and m.id=p_musical_id
  where s.date=p_date
    and exists(select 1 from public.show_casts sc where sc.show_id=s.id and sc.artist_id=p_actor_id);
$$;

create or replace function public.upsert_actor_rating(
  p_anonymous_user_id text, p_performance_id integer, p_actor_id integer, p_musical_id integer, p_role_id integer,
  p_singing_score numeric default null, p_dancing_score numeric default null, p_acting_score numeric default null,
  p_performance_date text default null, p_performance_time text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rating public.ratings; v_recent_count integer; v_dimension_count integer; v_role_confirmed boolean; v_musical_name text;
begin
  if p_anonymous_user_id is null or char_length(p_anonymous_user_id) not between 8 and 120 then raise exception 'anonymous_user_id is invalid'; end if;
  v_dimension_count := (case when p_singing_score is null then 0 else 1 end) + (case when p_dancing_score is null then 0 else 1 end) + (case when p_acting_score is null then 0 else 1 end);
  if v_dimension_count < 2 then raise exception 'at least two dimensions are required'; end if;
  if (p_singing_score is not null and (p_singing_score < .5 or p_singing_score > 5 or p_singing_score * 2 <> floor(p_singing_score * 2)))
     or (p_dancing_score is not null and (p_dancing_score < .5 or p_dancing_score > 5 or p_dancing_score * 2 <> floor(p_dancing_score * 2)))
     or (p_acting_score is not null and (p_acting_score < .5 or p_acting_score > 5 or p_acting_score * 2 <> floor(p_acting_score * 2))) then raise exception 'scores must be between 0.5 and 5.0 in 0.5 steps'; end if;
  if not exists (select 1 from public.actor_roles where artist_id=p_actor_id and musical_id=p_musical_id and role_id=p_role_id) then raise exception 'actor, musical and role do not form an existing cast relation'; end if;
  select count(*) into v_recent_count from public.ratings where anonymous_user_id=p_anonymous_user_id and updated_at > now()-interval '1 hour';
  if v_recent_count >= 30 then raise exception 'rating submission rate limit exceeded'; end if;
  if p_performance_id is null then
    if p_performance_date is null or p_performance_time is null or p_performance_date !~ '^\\d{4}-\\d{2}-\\d{2}$' or p_performance_time !~ '^([01]\\d|2[0-3]):[0-5]\\d$' then raise exception 'performance date and time are invalid'; end if;
    select name into v_musical_name from public.musicals where id=p_musical_id;
    select id into p_performance_id from public.shows where date=p_performance_date and time=p_performance_time and musical=v_musical_name and city='' and theatre='' limit 1;
    if p_performance_id is null then
      insert into public.shows(date,time,city,musical,theatre) values(p_performance_date,p_performance_time,'',v_musical_name,'') returning id into p_performance_id;
    end if;
    insert into public.show_casts(show_id,artist_id,role) values(p_performance_id,p_actor_id,'') on conflict do nothing;
  else
    if not exists (select 1 from public.shows s join public.musicals m on m.name=s.musical where s.id=p_performance_id and m.id=p_musical_id) then raise exception 'performance does not match musical'; end if;
    if not exists (select 1 from public.show_casts where show_id=p_performance_id and artist_id=p_actor_id) then raise exception 'actor is not listed in this performance'; end if;
  end if;
  if exists (select 1 from public.show_casts where show_id=p_performance_id and artist_id=p_actor_id and role_id is not null)
     and not exists (select 1 from public.show_casts where show_id=p_performance_id and artist_id=p_actor_id and role_id=p_role_id) then raise exception 'selected role conflicts with confirmed performance cast'; end if;
  select exists(select 1 from public.show_casts where show_id=p_performance_id and artist_id=p_actor_id and role_id=p_role_id) into v_role_confirmed;
  if not v_role_confirmed then
    insert into public.show_cast_role_submissions(show_id,artist_id,role_id,anonymous_user_id,status)
    values(p_performance_id,p_actor_id,p_role_id,p_anonymous_user_id,'pending')
    on conflict(show_id,artist_id,role_id) do update set updated_at=now();
  end if;
  insert into public.ratings(anonymous_user_id,performance_id,actor_id,musical_id,role_id,singing_score,dancing_score,acting_score,status)
  values(p_anonymous_user_id,p_performance_id,p_actor_id,p_musical_id,p_role_id,p_singing_score,p_dancing_score,p_acting_score,'valid')
  on conflict(anonymous_user_id,performance_id,actor_id,role_id) where performance_id is not null do update set
    singing_score=excluded.singing_score,dancing_score=excluded.dancing_score,acting_score=excluded.acting_score,status='valid'
  returning * into v_rating;
  return jsonb_build_object('id',v_rating.id,'status',v_rating.status,'updated_at',v_rating.updated_at,'cast_mapping_status',case when v_role_confirmed then 'confirmed' else 'pending' end);
end;
$$;

-- 清理 V1 的旧签名，避免匿名角色仍能绕过场次校验。
drop function if exists public.upsert_actor_rating(text,integer,integer,integer,integer,numeric,numeric,numeric);
drop function if exists public.upsert_actor_rating(text,integer,integer,integer,numeric,numeric,numeric);

create or replace function public.get_my_rating(
  p_anonymous_user_id text, p_performance_id integer, p_actor_id integer, p_musical_id integer, p_role_id integer
)
returns jsonb language sql security definer set search_path = public stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('singing_score',singing_score,'dancing_score',dancing_score,'acting_score',acting_score,'status',status,'updated_at',updated_at))->0,'null'::jsonb)
  from public.ratings where anonymous_user_id=p_anonymous_user_id and performance_id=p_performance_id and actor_id=p_actor_id and musical_id=p_musical_id and role_id=p_role_id;
$$;
drop function if exists public.get_my_rating(text,integer,integer,integer);

-- 同一用户看过同角色多场时，先在“用户 × 演员 × 剧目 × 角色”内求平均，避免多场提交放大其权重。
create or replace function public.get_rating_summary()
returns jsonb language sql security definer set search_path = public stable as $$
  with user_role_scores as (
    select anonymous_user_id,actor_id,musical_id,role_id,
      avg(singing_score) filter(where singing_score is not null) singing_avg,
      avg(dancing_score) filter(where dancing_score is not null) dancing_avg,
      avg(acting_score) filter(where acting_score is not null) acting_avg
    from public.ratings where status='valid' and performance_id is not null
    group by anonymous_user_id,actor_id,musical_id,role_id
  ), actor_stats as (
    select actor_id,count(distinct anonymous_user_id) user_count,avg(singing_avg) filter(where singing_avg is not null) singing_avg,avg(dancing_avg) filter(where dancing_avg is not null) dancing_avg,avg(acting_avg) filter(where acting_avg is not null) acting_avg
    from user_role_scores group by actor_id
  ), role_stats as (
    select actor_id,musical_id,role_id,count(*) user_count,avg(singing_avg) filter(where singing_avg is not null) singing_avg,avg(dancing_avg) filter(where dancing_avg is not null) dancing_avg,avg(acting_avg) filter(where acting_avg is not null) acting_avg
    from user_role_scores group by actor_id,musical_id,role_id
  ) select jsonb_build_object('actors',coalesce((select jsonb_agg(jsonb_build_object('actor_id',actor_id,'user_count',user_count,'singing_avg',round(singing_avg,3),'dancing_avg',round(dancing_avg,3),'acting_avg',round(acting_avg,3)) order by actor_id) from actor_stats where user_count>=10 and singing_avg is not null and dancing_avg is not null and acting_avg is not null),'[]'::jsonb),'roles',coalesce((select jsonb_agg(jsonb_build_object('actor_id',actor_id,'musical_id',musical_id,'role_id',role_id,'user_count',user_count,'singing_avg',round(singing_avg,3),'dancing_avg',round(dancing_avg,3),'acting_avg',round(acting_avg,3)) order by actor_id,musical_id,role_id) from role_stats where user_count>=10 and singing_avg is not null and dancing_avg is not null and acting_avg is not null),'[]'::jsonb));
$$;

revoke all on function public.get_rating_performances(integer,integer,integer,text) from public;
revoke all on function public.upsert_actor_rating(text,integer,integer,integer,integer,numeric,numeric,numeric,text,text) from public;
revoke all on function public.get_my_rating(text,integer,integer,integer,integer) from public;
revoke all on function public.get_rating_summary() from public;
grant execute on function public.get_rating_performances(integer,integer,integer,text) to anon,authenticated;
grant execute on function public.upsert_actor_rating(text,integer,integer,integer,integer,numeric,numeric,numeric,text,text) to anon,authenticated;
grant execute on function public.get_my_rating(text,integer,integer,integer,integer) to anon,authenticated;
grant execute on function public.get_rating_summary() to anon,authenticated;
