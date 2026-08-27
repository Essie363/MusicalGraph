-- Supabase 序列同步修复（一次性执行）
-- 导入历史数据时使用了显式 id，导致 serial 序列没有前进；
-- 审核新增关系/排期/精彩片段时从 1 开始，会撞主键冲突。
select setval('relations_id_seq', (select coalesce(max(id),0) from relations));
select setval('shows_id_seq', (select coalesce(max(id),0) from shows));
select setval('moments_id_seq', (select coalesce(max(id),0) from moments));
select setval('groups_id_seq', (select coalesce(max(id),0) from groups));
