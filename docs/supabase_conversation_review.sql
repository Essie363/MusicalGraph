-- Codex 对话审核字段（可重复执行）
-- 执行后，待审反馈可以在 Codex 对话中按需读取、批准、拒绝或暂缓。

alter table submissions
  add column if not exists conversation_review_state text not null default 'unreviewed',
  add column if not exists conversation_reviewed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'submissions_conversation_review_state_check'
      and conrelid = 'submissions'::regclass
  ) then
    alter table submissions
      add constraint submissions_conversation_review_state_check
      check (conversation_review_state in ('unreviewed', 'deferred'));
  end if;
end $$;

create index if not exists idx_submissions_conversation_review
  on submissions(conversation_review_state, created_at)
  where status = 'pending' and agent_status = 'ready';

-- 不增加匿名访问策略。对话审核接口仍由 Worker service key 访问。
