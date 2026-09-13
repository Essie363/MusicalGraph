-- Supabase 聚合接口：一次返回首页/详情页所需的轻量数据
-- 前端调用 POST /rest/v1/rpc/get_music_graph（body: {}）
create or replace function get_music_graph()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'artists', (select coalesce(jsonb_agg(to_jsonb(a) order by a.id), '[]'::jsonb) from (
      select id, name, nickname, birth_date, major, school, hometown, enrollment_year, height, note from artists) a),
    'musicals', (select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb) from (
      select id, name from musicals) m),
    'roles', (select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb) from (
      select id, musical_id, name from roles) r),
    'actor_roles', (select coalesce(jsonb_agg(to_jsonb(ar)), '[]'::jsonb) from (
      select artist_id, musical_id, role_id from actor_roles) ar),
    'relations', (select coalesce(jsonb_agg(to_jsonb(re) order by re.id), '[]'::jsonb) from (
      select id, actor_a, actor_b, type_id, detail from relations) re),
    'relation_types', (select coalesce(jsonb_agg(to_jsonb(rt) order by rt.id), '[]'::jsonb) from (
      select id, code from relation_types) rt),
    'moments', (select coalesce(jsonb_agg(to_jsonb(mm) order by mm.id), '[]'::jsonb) from (
      select id, actor_id, title, url, source from moments) mm),
    'rating_summary', public.get_rating_summary()
  );
$$;
grant execute on function get_music_graph() to anon;
grant execute on function get_music_graph() to authenticated;
