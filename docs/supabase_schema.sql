-- MusicGraph Supabase 建表脚本（一次性执行）
-- 来源：docs/DEPLOY.md + docs/DEPLOY_SUPABASE.md
-- 在 Supabase SQL Editor 中整体粘贴运行。
-- 表/索引使用 IF NOT EXISTS；策略与触发器先 DROP 再 CREATE，可安全重复执行。

-- ============ 1. 基础正式表 ============

create table if not exists relation_types (
  id serial primary key,
  code text unique not null,
  name text not null,
  is_builtin boolean default false,
  description text
);
insert into relation_types (code, name, is_builtin, description) values
  ('co_work','共演',true,null),
  ('classmate','同学',true,null),
  ('friend','好友',true,null),
  ('couple','情侣',true,'现实中的真实情侣关系'),
  ('teacher_student','师生',true,null),
  ('same_company','同公司',true,null),
  ('cp','CP',true,'粉丝组合/CP名')
on conflict (code) do nothing;

create table if not exists artists (
  id integer primary key,
  name text not null,
  nickname text,
  birth_date text,
  major text,
  school text,
  hometown text,
  enrollment_year text,
  height text,
  note text,
  is_actor boolean default true
);
create index if not exists idx_artists_name on artists(name);

create table if not exists musicals (
  id integer primary key,
  name text not null,
  is_original boolean,
  progress text,
  premiere_date text,
  info text
);
create index if not exists idx_musicals_name on musicals(name);

create table if not exists roles (
  id integer primary key,
  musical_id integer references musicals(id),
  name text
);
create index if not exists idx_roles_musical on roles(musical_id);

create table if not exists actor_roles (
  artist_id integer references artists(id),
  musical_id integer references musicals(id),
  role_id integer references roles(id)
);
create index if not exists idx_actor_roles_artist on actor_roles(artist_id);
create index if not exists idx_actor_roles_musical on actor_roles(musical_id);

create table if not exists shows (
  id serial primary key,
  date text, time text, city text, musical text, theatre text,
  unique(date,time,city,musical,theatre)
);
create index if not exists idx_shows_date on shows(date);

create table if not exists show_casts (
  show_id integer references shows(id),
  artist_id integer references artists(id),
  role text
);
create index if not exists idx_show_casts_show on show_casts(show_id);
create index if not exists idx_show_casts_artist on show_casts(artist_id);

create table if not exists co_work_edges (
  actor_a integer not null references artists(id),
  actor_b integer not null references artists(id),
  co_show_count integer default 0,
  co_musical_count integer default 0,
  first_co_date text,
  last_co_date text,
  primary key (actor_a, actor_b)
);

create table if not exists relations (
  id serial primary key,
  type_id integer not null references relation_types(id),
  actor_a integer not null references artists(id),
  actor_b integer not null references artists(id),
  detail text,
  source_type text not null default 'user',
  source_url text,
  evidence text,
  status text not null default 'pending',
  confidence real,
  submitted_by integer,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_relations_pair on relations(actor_a, actor_b);
create index if not exists idx_relations_status on relations(status);

create table if not exists groups (
  id serial primary key,
  name text unique not null,
  type text not null default 'cohort'
);
create table if not exists group_members (
  group_id integer references groups(id),
  artist_id integer references artists(id),
  unique(group_id, artist_id)
);

create table if not exists moments (
  id bigserial primary key,
  actor_id integer references artists(id),
  title text not null,
  url text not null,
  source text,
  description text,
  created_time text
);
create index if not exists idx_moments_actor on moments(actor_id);

create table if not exists review_logs (
  id serial primary key,
  relation_id integer references relations(id),
  action text,
  reviewer uuid,
  comment text,
  created_at timestamptz default now()
);

-- ============ 2. submissions 提交表 ============

create table if not exists submissions (
  id bigserial primary key,
  submission_type text not null check (submission_type in (
    'actor_update', 'musical_update', 'relation_update', 'moment_submission', 'schedule_submission')),
  actor_a text,
  actor_b text,
  musical_name text,
  relation_type text check (relation_type in ('co_work','classmate','teacher_student','same_company')),
  title text,
  url text,
  platform text check (platform in ('bilibili','netease','youtube','xiaohongshu')),
  description text,
  details jsonb,
  source_url text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  applied boolean not null default false,
  reviewed_at timestamptz,
  review_note text,
  client_id text not null,
  created_at timestamptz not null default now(),
  check (char_length(coalesce(actor_a,'')) <= 100),
  check (char_length(coalesce(actor_b,'')) <= 100),
  check (char_length(coalesce(musical_name,'')) <= 200),
  check (char_length(coalesce(title,'')) <= 300),
  check (char_length(coalesce(url,'')) <= 500),
  check (char_length(coalesce(source_url,'')) <= 500),
  check (details is null or jsonb_typeof(details) = 'object'),
  check (submission_type <> 'relation_update' or (actor_a is not null and actor_b is not null and relation_type is not null)),
  check (submission_type <> 'moment_submission' or (actor_a is not null and title is not null and url is not null))
);
create index if not exists idx_submissions_status on submissions(status);
create unique index if not exists uq_submissions_dedup on submissions (
  submission_type, coalesce(actor_a,''), coalesce(actor_b,''), coalesce(musical_name,''),
  coalesce(title,''), coalesce(url,''), coalesce(source_url,''));

-- ============ 3. RLS 安全规则 ============

alter table relation_types enable row level security;
alter table artists enable row level security;
alter table musicals enable row level security;
alter table roles enable row level security;
alter table actor_roles enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;
alter table shows enable row level security;
alter table show_casts enable row level security;
alter table co_work_edges enable row level security;
alter table relations enable row level security;
alter table moments enable row level security;
alter table submissions enable row level security;
alter table review_logs enable row level security;

do $$
declare t text;
begin
  foreach t in array array['relation_types','artists','musicals','roles','actor_roles','groups','group_members','shows','show_casts','co_work_edges','relations','moments'] loop
    execute format('drop policy if exists "public read" on %I', t);
    execute format('create policy "public read" on %I for select using (true)', t);
  end loop;
end $$;

drop policy if exists "anon insert submissions" on submissions;
create policy "anon insert submissions" on submissions
  for insert to anon with check (true);

-- 如需未来后台 API 审核，再放开下面两条（当前用 Studio 审核，不建）：
-- drop policy if exists "admin read submissions" on submissions;
-- create policy "admin read submissions" on submissions for select to authenticated using (true);
-- drop policy if exists "admin update submissions" on submissions;
-- create policy "admin update submissions" on submissions for update to authenticated using (true);

-- ============ 4. 提交校验 + 基础限流 ============

create or replace function submissions_before_insert() returns trigger language plpgsql as $$
begin
  if (select count(*) from submissions
      where client_id = new.client_id
        and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too many submissions, try later';
  end if;
  new.status := 'pending';
  new.applied := false;
  new.reviewed_at := null;
  return new;
end $$;
drop trigger if exists trg_submissions_before_insert on submissions;
create trigger trg_submissions_before_insert before insert on submissions
  for each row execute function submissions_before_insert();

-- ============ 5. 幂等审核自动入库 ============

create or replace function apply_approved_submission() returns trigger language plpgsql as $$
declare
  aid bigint; aid2 bigint; bid bigint; mid bigint; sid bigint; note text := '';
  item record; c record;
begin
  if new.status <> 'approved' or new.applied then
    return new;
  end if;

  if new.submission_type in ('actor_update','relation_update','moment_submission','schedule_submission') and new.actor_a is not null then
    select id into aid from artists where name = new.actor_a order by id limit 1;
    if aid is null then
      insert into artists(name) values (new.actor_a) returning id into aid;
      note := note || '新建演员 ' || new.actor_a || '；';
    end if;
  end if;
  if new.actor_b is not null then
    select id into bid from artists where name = new.actor_b order by id limit 1;
    if bid is null then
      insert into artists(name) values (new.actor_b) returning id into bid;
      note := note || '新建演员 ' || new.actor_b || '；';
    end if;
  end if;
  if new.musical_name is not null then
    select id into mid from musicals where name = new.musical_name order by id limit 1;
    if mid is null then
      insert into musicals(name) values (new.musical_name) returning id into mid;
      note := note || '新建剧目 ' || new.musical_name || '；';
    end if;
  end if;

  if new.submission_type = 'actor_update' then
    update artists set
      nickname = coalesce(new.details->>'nickname', nickname),
      birth_date = coalesce(new.details->>'birth_date', birth_date),
      major = coalesce(new.details->>'major', major),
      school = coalesce(new.details->>'school', school),
      hometown = coalesce(new.details->>'hometown', hometown),
      enrollment_year = coalesce(new.details->>'enrollment_year', enrollment_year),
      height = coalesce(new.details->>'height', height),
      note = coalesce(new.details->>'note', note)
    where id = aid;

  elsif new.submission_type = 'musical_update' then
    update musicals set
      info = coalesce(new.details->>'info', info),
      premiere_date = coalesce(new.details->>'premiere_date', premiere_date)
    where id = mid;

  elsif new.submission_type = 'relation_update' then
    if not exists (
      select 1 from relations r
      where r.type_id = (select id from relation_types where code = new.relation_type)
        and ((r.actor_a = aid and r.actor_b = bid) or (r.actor_a = bid and r.actor_b = aid))
    ) then
      insert into relations(actor_a, actor_b, type_id, detail, source_url, status)
      values (aid, bid,
              (select id from relation_types where code = new.relation_type),
              new.description, new.source_url, 'approved');
    end if;

  elsif new.submission_type = 'moment_submission' then
    if not exists (select 1 from moments where actor_id = aid and url = new.url) then
      insert into moments(actor_id, title, url, source, description)
      values (aid, new.title, new.url, new.platform, new.description);
    end if;

    elsif new.submission_type = 'schedule_submission' and jsonb_typeof(new.details) = 'array' then
    for item in select value from jsonb_array_elements(new.details) loop
      if item.value->>'date' is null then continue; end if;
      insert into shows(date, time, city, musical, theatre)
      values (item.value->>'date', item.value->>'time', item.value->>'city', item.value->>'musical', item.value->>'theatre')
      on conflict (date, time, city, musical, theatre) do nothing
      returning id into sid;
      if sid is not null and jsonb_typeof(item.value->'cast') = 'array' then
        for c in select value from jsonb_array_elements(item.value->'cast') loop
          select id into aid2 from artists where name = c.value->>'actor' order by id limit 1;
          if aid2 is null then
            insert into artists(name) values (c.value->>'actor') returning id into aid2;
          end if;
          insert into show_casts(show_id, artist_id, role)
          values (sid, aid2, coalesce(c.value->>'role',''))
          on conflict do nothing;
        end loop;
      end if;
    end loop;
  end if;

  new.applied := true;
  new.reviewed_at := now();
  new.review_note := coalesce(note, '已写入正式库');
  return new;
end $$;
drop trigger if exists trg_submissions_apply on submissions;
create trigger trg_submissions_apply before update of status on submissions
  for each row when (new.status = 'approved') execute function apply_approved_submission();