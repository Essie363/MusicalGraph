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
-- 审核触发器统一由 docs/supabase_feedback_and_fix.sql / docs/supabase_approval_fix.sql 维护；
-- 本文件只负责共演边重算函数，不再覆盖 apply_approved_submission（旧版会丢失勘误逻辑）。

-- 立即重建一次，把已审核通过的剧目角色/排期数据纳入共演边
select rebuild_co_work();