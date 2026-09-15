-- 修复真实场次评分的午 / 夕 / 晚场标签
-- 执行位置：Supabase SQL Editor
-- 可重复执行；只更新关联了真实 shows.id 的评分记录，不改评分数值。

create or replace function rating_session_from_show_time(p_time text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when lower(coalesce(p_time, '')) ~ '(晚|夜|night)' then 'night'
    when lower(coalesce(p_time, '')) ~ '(夕|傍晚|黄昏)' then 'evening'
    when lower(coalesce(p_time, '')) ~ '(^|[^0-9])(0?[0-9]|1[0-5])(:[0-9]{2})?([^0-9]|$)' then 'matinee'
    when lower(coalesce(p_time, '')) ~ '(^|[^0-9])(1[6-7])(:[0-9]{2})?([^0-9]|$)' then 'evening'
    when lower(coalesce(p_time, '')) ~ '(^|[^0-9])(1[8-9]|2[0-3])(:[0-9]{2})?([^0-9]|$)' then 'night'
    else null
  end;
$$;

update ratings r
set session_period = rating_session_from_show_time(s.time)
from shows s
where r.performance_id = s.id
  and rating_session_from_show_time(s.time) is not null
  and r.session_period is distinct from rating_session_from_show_time(s.time);

-- 结果应显示受影响记录已按正确时段分组。
select session_period, count(*)
from ratings
where performance_id is not null
group by session_period
order by session_period;
