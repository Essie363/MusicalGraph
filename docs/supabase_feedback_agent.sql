-- MusicGraph feedback agent fields (run once in Supabase SQL Editor).
-- The agent only writes review suggestions. It never changes status to approved.

alter table submissions
  add column if not exists agent_status text not null default 'unprocessed',
  add column if not exists agent_analysis jsonb,
  add column if not exists agent_processed_at timestamptz,
  add column if not exists agent_error text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'submissions_agent_status_check'
      and conrelid = 'submissions'::regclass
  ) then
    alter table submissions
      add constraint submissions_agent_status_check
      check (agent_status in ('unprocessed', 'processing', 'ready', 'failed'));
  end if;
end $$;

create index if not exists idx_submissions_agent_queue
  on submissions (agent_status, created_at)
  where status = 'pending';

comment on column submissions.agent_analysis is
  'AI-generated review suggestion only; original submission remains authoritative.';

-- No anon SELECT or UPDATE policy is added. The Worker uses a service-role secret.
