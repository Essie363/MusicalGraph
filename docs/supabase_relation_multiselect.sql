-- Supabase 人物关系多选迁移（一次性执行，可重复运行）
-- 保留旧 relation_type 字段和旧提交，只为新提交增加 relation_types 数组。

alter table submissions
  add column if not exists relation_types text[];

alter table submissions
  drop constraint if exists submissions_relation_type_check;

alter table submissions
  add constraint submissions_relation_type_check check (
    relation_type is null or relation_type in (
      'co_work','classmate','friend','family','couple','teacher_student',
      'same_company','cp','married','ex','roommate'
    )
  );

alter table submissions
  drop constraint if exists submissions_relation_types_check;

alter table submissions
  add constraint submissions_relation_types_check check (
    relation_types is null or (
      cardinality(relation_types) between 1 and 3
      and relation_types <@ array[
        'co_work','classmate','friend','family','couple','teacher_student',
        'same_company','cp','married','ex','roommate'
      ]::text[]
    )
  );

insert into relation_types (code, name, is_builtin, description) values
  ('co_work','共演',true,null),
  ('classmate','同学',true,null),
  ('friend','好友',true,null),
  ('family','亲人',true,null),
  ('couple','情侣',true,'现实中的真实情侣关系'),
  ('teacher_student','师生',true,null),
  ('same_company','同公司',true,null),
  ('cp','CP',true,'粉丝组合/CP名'),
  ('married','伴侣',true,'现实中的伴侣或婚姻关系'),
  ('ex','前任',true,'现实中的前任关系'),
  ('roommate','室友',true,null)
on conflict (code) do nothing;

-- 旧索引没有关系类型，同一人物对使用同一来源补充不同关系时会被误判为重复。
drop index if exists uq_submissions_dedup;
create unique index uq_submissions_dedup on submissions (
  submission_type, coalesce(actor_a,''), coalesce(actor_b,''), coalesce(musical_name,''),
  coalesce(relation_type,''), coalesce(relation_types, '{}'::text[]),
  coalesce(title,''), coalesce(url,''), coalesce(source_url,''));

create or replace function apply_approved_multi_relation_submission()
returns trigger language plpgsql as $$
declare
  aid bigint;
  bid bigint;
  relation_type_id integer;
  relation_code text;
  previous_relation_code text;
  relation_detail text;
  applied_count integer := 0;
  removed_count integer := 0;
begin
  if new.status <> 'approved' or new.applied
     or new.submission_type <> 'relation_update'
     or coalesce(cardinality(new.relation_types), 0) = 0 then
    return new;
  end if;

  select id into aid from artists where name = new.actor_a order by id limit 1;
  if aid is null then
    insert into artists(name) values (new.actor_a) returning id into aid;
  end if;

  select id into bid from artists where name = new.actor_b order by id limit 1;
  if bid is null then
    insert into artists(name) values (new.actor_b) returning id into bid;
  end if;

  -- 勘误提交明确保存“修改前”和“修改后”。只停用修改前有、修改后没有的关系。
  if new.details->'fix'->>'field' = 'relation_types'
     and jsonb_typeof(new.details->'fix'->'previous_relation_types') = 'array' then
    for previous_relation_code in
      select distinct jsonb_array_elements_text(new.details->'fix'->'previous_relation_types')
    loop
      if not (previous_relation_code = any(new.relation_types)) then
        select id into relation_type_id
        from relation_types
        where code = previous_relation_code
        limit 1;

        if relation_type_id is not null then
          update relations
          set status = 'rejected'
          where type_id = relation_type_id
            and status = 'approved'
            and ((actor_a = aid and actor_b = bid) or (actor_a = bid and actor_b = aid));
          if found then removed_count := removed_count + 1; end if;
        end if;
      end if;
    end loop;
  end if;

  for relation_code in select distinct unnest(new.relation_types) loop
    select id into relation_type_id
    from relation_types
    where code = relation_code
    limit 1;

    if relation_type_id is null then
      raise exception 'unknown relation type: %', relation_code;
    end if;

    relation_detail := nullif(new.details->'relation_details'->>relation_code, '');
    if relation_detail is null and not (coalesce(new.details, '{}'::jsonb) ? 'fix') then
      relation_detail := nullif(new.description, '');
    end if;

    if exists (
      select 1 from relations r
      where r.type_id = relation_type_id
        and ((r.actor_a = aid and r.actor_b = bid) or (r.actor_a = bid and r.actor_b = aid))
    ) then
      update relations
      set detail = coalesce(relation_detail, detail), status = 'approved'
      where type_id = relation_type_id
        and ((actor_a = aid and actor_b = bid) or (actor_a = bid and actor_b = aid));
    else
      insert into relations(actor_a, actor_b, type_id, detail, source_url, source_type, status)
      values (least(aid, bid), greatest(aid, bid), relation_type_id,
              relation_detail, new.source_url, 'user', 'approved');
    end if;

    applied_count := applied_count + 1;
  end loop;

  new.applied := true;
  new.reviewed_at := now();
  new.review_note := concat_ws('；', nullif(new.review_note, ''),
    '已写入 ' || applied_count || ' 种人物关系',
    case when removed_count > 0 then '已停用 ' || removed_count || ' 种原关系' end);
  return new;
end $$;

-- PostgreSQL 按名称顺序执行同类触发器。00 前缀确保多选处理先于旧单选处理，
-- 随后旧触发器会看到 applied=true 并直接返回。
drop trigger if exists trg_00_submissions_apply_multi_relation on submissions;
create trigger trg_00_submissions_apply_multi_relation
  before update of status on submissions
  for each row when (new.status = 'approved')
  execute function apply_approved_multi_relation_submission();
