-- 修复：允许匿名提交 submissions（RLS 策略 + 表权限）
drop policy if exists "anon insert submissions" on submissions;
create policy "anon insert submissions" on submissions
  for insert to anon with check (true);
grant insert on submissions to anon;