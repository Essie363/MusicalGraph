-- Supabase 反馈 + 勘误闭环升级（一次性执行）
-- 1) submissions 增加 feedback 类型
-- 2) 关系类型允许 cp/couple/married/ex（用于感情/CP 的补充与勘误）
-- 3) 审核触发器升级：补充新增，勘误更新已有数据

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'submissions_submission_type_check' and conrelid = 'submissions'::regclass) then
    alter table submissions drop constraint submissions_submission_type_check;
  end if;
end $$;
alter table submissions add constraint submissions_submission_type_check check (
  submission_type in ('actor_update','musical_update','relation_update','moment_submission','schedule_submission','feedback'));

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'submissions_relation_type_check' and conrelid = 'submissions'::regclass) then
    alter table submissions drop constraint submissions_relation_type_check;
  end if;
end $$;
alter table submissions add constraint submissions_relation_type_check check (
  relation_type in ('co_work','classmate','teacher_student','same_company','cp','couple','married','ex'));

create or replace function apply_approved_submission() returns trigger language plpgsql as $$
declare
  aid bigint; aid2 bigint; bid bigint; mid bigint; sid bigint; note text := '';
  item record; c record; d jsonb; fix jsonb;
begin
  if new.status <> 'approved' or new.applied then
    return new;
  end if;

  if new.submission_type = 'feedback' then
    new.applied := true;
    new.reviewed_at := now();
    new.review_note := '反馈已记录';
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

  d := new.details;

  if new.submission_type = 'actor_update' then
    fix := coalesce(d->'fix', null);
    if fix is not null and fix->>'field' is not null and fix->>'correct' is not null
       and fix->>'field' in ('name','nickname','birth_date','major','school','hometown','enrollment_year','height','note') then
      execute format('update artists set %I = %L where id = %s', fix->>'field', fix->>'correct', aid);
      note := note || '已修正演员字段 ' || fix->>'field' || '；';
    end if;
    update artists set
      nickname = coalesce(d->>'nickname', nickname),
      birth_date = coalesce(d->>'birth_date', birth_date),
      major = coalesce(d->>'major', major),
      school = coalesce(d->>'school', school),
      hometown = coalesce(d->>'hometown', hometown),
      enrollment_year = coalesce(d->>'enrollment_year', enrollment_year),
      height = coalesce(d->>'height', height),
      note = coalesce(d->>'note', artists.note)
    where id = aid;

  elsif new.submission_type = 'musical_update' then
    fix := coalesce(d->'fix', null);
    if fix is not null and fix->>'field' is not null and fix->>'correct' is not null then
      if fix->>'field' = 'name' then
        update musicals set name = fix->>'correct' where id = mid;
        note := note || '已修正剧目名称；';
      elsif fix->>'field' = 'year' then
        update musicals set premiere_date = fix->>'correct' where id = mid;
        note := note || '已修正首演年份；';
      elsif fix->>'field' = 'cast' and fix->>'actor' is not null then
        select id into aid2 from artists where name = fix->>'actor' order by id limit 1;
        if aid2 is null then insert into artists(name) values (fix->>'actor') returning id into aid2; end if;
        select id into sid from roles where musical_id = mid and name = fix->>'correct' limit 1;
        if sid is null then insert into roles(musical_id, name) values (mid, fix->>'correct') returning id into sid; end if;
        update actor_roles set role_id = sid where artist_id = aid2 and musical_id = mid;
        if not found then insert into actor_roles(artist_id, musical_id, role_id) values (aid2, mid, sid); end if;
        note := note || '已修正卡司角色；';
      else
        note := note || '暂未支持的剧目勘误字段 ' || fix->>'field' || '；';
      end if;
    end if;
    update musicals set
      info = coalesce(d->>'info', info),
      premiere_date = coalesce(d->>'premiere_date', premiere_date)
    where id = mid;
    if d is not null and d->'cast' is not null and jsonb_typeof(d->'cast') = 'array' then
      for c in select value from jsonb_array_elements(d->'cast') loop
        select id into aid2 from artists where name = c.value->>'actor' order by id limit 1;
        if aid2 is null then insert into artists(name) values (c.value->>'actor') returning id into aid2; end if;
        if coalesce(c.value->>'role','') = '' then
          if not exists (select 1 from actor_roles where artist_id = aid2 and musical_id = mid and role_id is null) then
            insert into actor_roles(artist_id, musical_id, role_id) values (aid2, mid, null);
          end if;
        else
          select id into sid from roles where musical_id = mid and name = c.value->>'role' limit 1;
          if sid is null then insert into roles(musical_id, name) values (mid, c.value->>'role') returning id into sid; end if;
          if not exists (select 1 from actor_roles where artist_id = aid2 and musical_id = mid and role_id = sid) then
            insert into actor_roles(artist_id, musical_id, role_id) values (aid2, mid, sid);
          end if;
        end if;
      end loop;
    end if;

  elsif new.submission_type = 'relation_update' then
    fix := coalesce(d->'fix', null);
    if fix is not null and fix->>'correct' is not null then
      if exists (
        select 1 from relations r
        where r.type_id = (select id from relation_types where code = new.relation_type)
          and ((r.actor_a = aid and r.actor_b = bid) or (r.actor_a = bid and r.actor_b = aid))
      ) then
        update relations set detail = fix->>'correct', status = 'approved'
        where type_id = (select id from relation_types where code = new.relation_type)
          and ((actor_a = aid and actor_b = bid) or (actor_a = bid and actor_b = aid));
        note := note || '已修正关系描述；';
      else
        insert into relations(actor_a, actor_b, type_id, detail, source_url, status)
        values (aid, bid, (select id from relation_types where code = new.relation_type), fix->>'correct', new.source_url, 'approved');
      end if;
    elsif not exists (
      select 1 from relations r
      where r.type_id = (select id from relation_types where code = new.relation_type)
        and ((r.actor_a = aid and r.actor_b = bid) or (r.actor_a = bid and r.actor_b = aid))
    ) then
      insert into relations(actor_a, actor_b, type_id, detail, source_url, status)
      values (aid, bid, (select id from relation_types where code = new.relation_type), new.description, new.source_url, 'approved');
    end if;

  elsif new.submission_type = 'moment_submission' then
    if not exists (select 1 from moments where actor_id = aid and url = new.url) then
      insert into moments(actor_id, title, url, source, description)
      values (aid, new.title, new.url, new.platform, new.description);
    end if;

  elsif new.submission_type = 'schedule_submission' and d is not null and jsonb_typeof(d) = 'array' then
    for item in select value from jsonb_array_elements(d) loop
      if item.value->>'date' is null then continue; end if;
      insert into shows(date, time, city, musical, theatre)
      values (item.value->>'date', item.value->>'time', item.value->>'city', item.value->>'musical', item.value->>'theatre')
      on conflict (date, time, city, musical, theatre) do nothing
      returning id into sid;
      if sid is not null and jsonb_typeof(item.value->'cast') = 'array' then
        for c in select value from jsonb_array_elements(item.value->'cast') loop
          select id into aid2 from artists where name = c.value->>'actor' order by id limit 1;
          if aid2 is null then insert into artists(name) values (c.value->>'actor') returning id into aid2; end if;
          insert into show_casts(show_id, artist_id, role)
          values (sid, aid2, coalesce(c.value->>'role',''))
          on conflict do nothing;
        end loop;
      end if;
    end loop;
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