-- 匿名评分归并到登录账号
-- 执行位置：Supabase SQL Editor
-- 适用对象：已经执行过 supabase_auth_ratings.sql 的项目。
-- 本脚本只新增一条 RPC，不改已有评分记录，首次用户登录调用时才会归并该浏览器的匿名记录。

create or replace function claim_anonymous_ratings(
  p_anonymous_user_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_anonymous_rating ratings%rowtype;
  v_account_rating ratings%rowtype;
  v_claimed_count integer := 0;
begin
  if v_user_id is null then
    raise exception '请先登录后再认领匿名评分';
  end if;
  if p_anonymous_user_id is null or btrim(p_anonymous_user_id) = '' then
    raise exception '匿名评分缺少客户端标识';
  end if;

  for v_anonymous_rating in
    select *
    from ratings
    where user_id is null
      and anonymous_user_id = p_anonymous_user_id
    order by id
    for update
  loop
    select * into v_account_rating
    from ratings
    where user_id = v_user_id
      and rating_slot = v_anonymous_rating.rating_slot
      and (
        (
          v_anonymous_rating.musical_id is not null
          and musical_id = v_anonymous_rating.musical_id
          and role_id = v_anonymous_rating.role_id
          and actor_id = v_anonymous_rating.actor_id
        )
        or (
          v_anonymous_rating.manual_musical_name is not null
          and manual_musical_name is not null
          and actor_id = v_anonymous_rating.actor_id
          and lower(manual_musical_name) = lower(v_anonymous_rating.manual_musical_name)
          and lower(manual_role_name) = lower(v_anonymous_rating.manual_role_name)
        )
      )
    for update;

    if found then
      if v_anonymous_rating.updated_at > v_account_rating.updated_at then
        update ratings
        set performance_id = v_anonymous_rating.performance_id,
            performance_date = v_anonymous_rating.performance_date,
            session_period = v_anonymous_rating.session_period,
            singing_score = v_anonymous_rating.singing_score,
            dancing_score = v_anonymous_rating.dancing_score,
            acting_score = v_anonymous_rating.acting_score,
            cast_mapping_status = v_anonymous_rating.cast_mapping_status
        where id = v_account_rating.id;
      end if;
      delete from ratings where id = v_anonymous_rating.id;
    else
      update ratings
      set user_id = v_user_id,
          anonymous_user_id = null
      where id = v_anonymous_rating.id;
    end if;

    v_claimed_count := v_claimed_count + 1;
  end loop;

  return jsonb_build_object('claimed_count', v_claimed_count);
end;
$$;

revoke all on function claim_anonymous_ratings(text) from public;
grant execute on function claim_anonymous_ratings(text) to authenticated;
