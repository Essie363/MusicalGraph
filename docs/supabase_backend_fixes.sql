-- Supabase 后端修复（一次性执行）
-- 1) 允许匿名提交 submissions
-- 2) 让 actors/musicals/roles 的 id 自增，审核触发器创建新人物/剧目时不会失败

drop policy if exists "anon insert submissions" on submissions;
create policy "anon insert submissions" on submissions
  for insert to anon with check (true);
grant insert on submissions to anon;

create sequence if not exists artists_id_seq;
select setval('artists_id_seq', (select coalesce(max(id),0) from artists));
alter table artists alter column id set default nextval('artists_id_seq');

create sequence if not exists musicals_id_seq;
select setval('musicals_id_seq', (select coalesce(max(id),0) from musicals));
alter table musicals alter column id set default nextval('musicals_id_seq');

create sequence if not exists roles_id_seq;
select setval('roles_id_seq', (select coalesce(max(id),0) from roles));
alter table roles alter column id set default nextval('roles_id_seq');