-- MusicGraph Supabase 共演边升级脚本
-- 用途：按同场排期重算共演边（同一场演出共同卡司才算共演）；
--       审核通过排期类提交后自动重算；剧目角色数据不影响共演，仅在演员资料中展示。
-- 执行：在 Supabase SQL Editor 粘贴整个文件运行（可重复执行）。
-- 执行后：共演边立即重建；以后在 Studio 里审核通过剧目/排期提交时也会自动重建。

create or replace function rebuild_co_work() returns void language plpgsql as $$
begin
  delete from co_work_edges;
  insert into co_work_edges(actor_a, actor_b, co_show_count, co_musical_count, first_co_date, last_co_date)
  select t.actor_a, t.actor_b,
         sum(t.co_show_count), sum(t.co_musical_count),
         min(t.first_co_date), max(t.last_co_date)
  from (
    select least(a.artist_id, b.artist_id) actor_a,
           greatest(a.artist_id, b.artist_id) actor_b,
           count(distinct a.show_id) co_show_count,
           count(distinct s.musical) co_musical_count,
           min(s.date) first_co_date,
           max(s.date) last_co_date
    from show_casts a
    join show_casts b on b.show_id = a.show_id and b.artist_id <> a.artist_id
    join shows s on s.id = a.show_id
    group by 1, 2
  ) t
  group by t.actor_a, t.actor_b;
end $$;
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

  -- 涉及排期的审核通过后，自动重算共演边（同场卡司）
  if new.submission_type = 'schedule_submission' then
    perform rebuild_co_work();
  end if;
  new.applied := true;
  new.reviewed_at := now();
  new.review_note := coalesce(note, '已写入正式库');
  return new;
end $$;
drop trigger if exists trg_submissions_apply on submissions;
create trigger trg_submissions_apply before update of status on submissions
  for each row when (new.status = 'approved') execute function apply_approved_submission();

-- 立即重建一次，把已审核通过的剧目角色/排期数据纳入共演边
select rebuild_co_work();