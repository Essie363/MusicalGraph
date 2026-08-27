# DEPLOY_SUPABASE — Supabase 部署上线方案（当前路线）

> 2026-08-23 · 由 PocketBase 本地后端切换为 Supabase 云端后端的正式执行方案。
> 配套存档：PocketBase 完整实现位于 `archive/pocketbase/`（tag `archive/pocketbase-2026-08-23`），仅作国内云服务器回退。
> 前端保持现有原生 HTML/CSS/JS + Canvas，通过 REST 直连 Supabase；`web/` 静态快照仅作回退。

## 1. 安全红线（先读）

- 前端只使用 **anon / publishable key**（本来就是公开配置，可以进前端）。
- **service role key 只允许出现在本地 `.env` / 本机脚本**，禁止：
  - 复制进 GitHub 仓库；
  - 写进 `web/` 任何文件；
  - 写进 Cloudflare Pages 的公开构建产物。
- 所有正式表必须开启 RLS；影响面最小的原则是：公开读、仅管理员写、匿名只能插入 `submissions`。
- 上线前必须用 anon key 实测：能读公开表、能插 `submissions`、不能改正式表。

## 2. 前置准备

1. 注册 Supabase（免费）账号。
2. 因为 region 一旦创建不能改，**先做延迟实测再建最终项目**：
   - 建议创建两个临时免费项目：一个 region 选新加坡，一个选东京（建完可删）。
   - 本机 PowerShell 对两个项目 URL 各跑 3 组测试，取中位数：

   ```powershell
   $targets = @(
     @{ Name = "Singapore"; Url = "https://xxxx.supabase.co"; AnonKey = "eyJ...anon key..." },
     @{ Name = "Tokyo";     Url = "https://yyyy.supabase.co"; AnonKey = "eyJ...anon key..." }
   )
   foreach ($t in $targets) {
     $headers = @{ apikey = $t.AnonKey; Authorization = "Bearer " + $t.AnonKey }
     $ms = 1..3 | ForEach-Object {
       1..5 | ForEach-Object {
         (Measure-Command { Invoke-WebRequest -Uri ($t.Url + "/rest/v1/relation_types?limit=1") -Headers $headers -UseBasicParsing -TimeoutSec 10 }).TotalMilliseconds
       }
     }
     $med = ($ms | Sort-Object)[[int]($ms.Count / 2)]
     Write-Host ("{0}: 中位数 {1:N0} ms" -f $t.Name, $med)
   }
   ```

   - 取中位数更快的 region 创建正式项目；删除另一个临时项目。
3. 在正式项目里记录三样东西：
   - Project URL：`https://<project-ref>.supabase.co`
   - anon key（公开）
   - service_role key（保密，只进 `.env`）

## 3. 建表

在 Supabase SQL Editor 执行：

> **共演关系升级（必做）**：执行完建表 SQL 后，再打开 [supabase_co_work.sql](../docs/supabase_co_work.sql) 并把整个内容粘贴运行一次。它会：1) 按同场排期重算共演边（同场共同卡司才算共演）；2) 让审核通过剧目/排期提交后自动重算；3) 立即重建一次。前端在线模式已改为直接读取 Supabase 共演边。`n`n> 已汇总成一份 `docs/supabase_schema.sql`，可直接整体粘贴执行（表/索引幂等，策略与触发器可重跑）。`n

1. 先执行 `docs/DEPLOY.md` 第 1 步已有的正式表 SQL（relation_types / artists / musicals / roles / actor_roles / shows / show_casts / co_work_edges / relations / groups / group_members / review_logs）。
2. 先补 `moments` 表（DEPLOY.md 未包含，前端精彩片段需要）：

```sql
create table if not exists moments (
  id bigserial primary key,
  actor_id integer references artists(id),
  title text not null,
  url text not null,
  source text,
  description text,
  created_time text
);
create index if not exists idx_moments_actor on moments(actor_id);
```

3. 再执行下面的 `submissions` 表与安全对象。

```sql
-- 用户提交表（四类 + 排期批量）
create table if not exists submissions (
  id bigserial primary key,
  submission_type text not null check (submission_type in (
    'actor_update', 'musical_update', 'relation_update', 'moment_submission', 'schedule_submission')),
  actor_a text,
  actor_b text,
  musical_name text,
  relation_type text check (relation_type in ('co_work','classmate','teacher_student','same_company')),
  title text,
  url text,
  platform text check (platform in ('bilibili','netease','youtube','xiaohongshu')),
  description text,
  details jsonb,
  source_url text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  applied boolean not null default false,
  reviewed_at timestamptz,
  review_note text,
  client_id text not null,
  created_at timestamptz not null default now(),
  -- 基本长度/必填校验
  check (char_length(coalesce(actor_a,'')) <= 100),
  check (char_length(coalesce(actor_b,'')) <= 100),
  check (char_length(coalesce(musical_name,'')) <= 200),
  check (char_length(coalesce(title,'')) <= 300),
  check (char_length(coalesce(url,'')) <= 500),
  check (char_length(coalesce(source_url,'')) <= 500),
  check (details is null or jsonb_typeof(details) = 'object'),
  check (submission_type <> 'relation_update' or (actor_a is not null and actor_b is not null and relation_type is not null)),
  check (submission_type <> 'moment_submission' or (actor_a is not null and title is not null and url is not null))
);
create index if not exists idx_submissions_status on submissions(status);
-- 防重复：同类型 + 关键字段 + 来源在库里只允许一条
create unique index if not exists uq_submissions_dedup on submissions (
  submission_type, coalesce(actor_a,''), coalesce(actor_b,''), coalesce(musical_name,''),
  coalesce(title,''), coalesce(url,''), coalesce(source_url,''));
```

```sql
-- RLS：正式表公开读、匿名不可写
alter table relation_types enable row level security;
alter table artists enable row level security;
alter table musicals enable row level security;
alter table roles enable row level security;
alter table actor_roles enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;
alter table shows enable row level security;
alter table show_casts enable row level security;
alter table co_work_edges enable row level security;
alter table relations enable row level security;
alter table moments enable row level security;
alter table submissions enable row level security;
alter table review_logs enable row level security;

create policy "public read" on artists for select using (true);
create policy "public read" on musicals for select using (true);
create policy "public read" on roles for select using (true);
create policy "public read" on actor_roles for select using (true);
create policy "public read" on groups for select using (true);
create policy "public read" on group_members for select using (true);
create policy "public read" on shows for select using (true);
create policy "public read" on show_casts for select using (true);
create policy "public read" on co_work_edges for select using (true);
create policy "public read" on relations for select using (true);
create policy "public read" on relation_types for select using (true);
create policy "public read" on moments for select using (true);

-- 匿名只能插入 submissions；默认没有 select/update policy = 匿名不可读改
create policy "anon insert submissions" on submissions
  for insert to anon with check (true);

-- 未来若要做后台 API：authenticated 可读改（当前用 Studio 审核，可不建这两条）
-- create policy "admin read submissions" on submissions for select to authenticated using (true);
-- create policy "admin update submissions" on submissions for update to authenticated using (true);
```

```sql
-- 提交校验 + 基础限流（同一 client_id 1 小时内最多 10 条）
create or replace function submissions_before_insert() returns trigger language plpgsql as $$
begin
  if (select count(*) from submissions
      where client_id = new.client_id
        and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too many submissions, try later';
  end if;
  new.status := 'pending';
  new.applied := false;
  new.reviewed_at := null;
  return new;
end $$;
create trigger trg_submissions_before_insert before insert on submissions
  for each row execute function submissions_before_insert();
```

```sql
-- 幂等审核：approved 时自动落正式表（applied 防止重复执行）
create or replace function apply_approved_submission() returns trigger language plpgsql as $$
declare
  aid bigint; bid bigint; mid bigint; sid bigint; aid2 bigint; note text := '';
  item record; c record;
begin
  if new.status <> 'approved' or new.applied then
    return new;
  end if;

  -- 演员/剧目按名称查找，缺失时创建占位
  if new.submission_type in ('actor_update','relation_update','moment_submission','schedule_submission') and new.actor_a is not null then
    select id into aid from artists where name = new.actor_a order by id limit 1;
    if aid is null then
      insert into artists(name) values (new.actor_a) returning id into aid;
      note := note || '新建演员 ' || new.actor_a || '；';
    end if;
  end if;
  if new.actor_b is not null then
    select id into bid from artists where name = new.actor_b order by id limit 1;
    if bid is null then
      insert into artists(name) values (new.actor_b) returning id into bid;
      note := note || '新建演员 ' || new.actor_b || '；';
    end if;
  end if;
  if new.musical_name is not null then
    select id into mid from musicals where name = new.musical_name order by id limit 1;
    if mid is null then
      insert into musicals(name) values (new.musical_name) returning id into mid;
      note := note || '新建剧目 ' || new.musical_name || '；';
    end if;
  end if;

  if new.submission_type = 'actor_update' then
    update artists set
      nickname = coalesce(new.details->>'nickname', nickname),
      birth_date = coalesce(new.details->>'birth_date', birth_date),
      major = coalesce(new.details->>'major', major),
      school = coalesce(new.details->>'school', school),
      hometown = coalesce(new.details->>'hometown', hometown),
      enrollment_year = coalesce(new.details->>'enrollment_year', enrollment_year),
      height = coalesce(new.details->>'height', height),
      note = coalesce(new.details->>'note', note)
    where id = aid;
    elsif new.submission_type = 'musical_update' then
    update musicals set
      info = coalesce(new.details->>'info', info),
      premiere_date = coalesce(new.details->>'premiere_date', premiere_date)
    where id = mid;

  elsif new.submission_type = 'relation_update' then
    if not exists (
      select 1 from relations r
      where r.type_id = (select id from relation_types where code = new.relation_type)
        and ((r.actor_a = aid and r.actor_b = bid) or (r.actor_a = bid and r.actor_b = aid))
    ) then
      insert into relations(actor_a, actor_b, type_id, detail, source_url, status)
      values (aid, bid,
              (select id from relation_types where code = new.relation_type),
              new.description, new.source_url, 'approved');
    end if;

  elsif new.submission_type = 'moment_submission' then
    if not exists (select 1 from moments where actor_id = aid and url = new.url) then
      insert into moments(actor_id, title, url, source, description)
      values (aid, new.title, new.url, new.platform, new.description);
    end if;

    elsif new.submission_type = 'schedule_submission' and jsonb_typeof(new.details) = 'array' then
    for item in select value from jsonb_array_elements(new.details) loop
      if item.value->>'date' is null then continue; end if;
      insert into shows(date, time, city, musical, theatre)
      values (item.value->>'date', item.value->>'time', item.value->>'city', item.value->>'musical', item.value->>'theatre')
      on conflict (date, time, city, musical, theatre) do nothing
      returning id into sid;
      if sid is not null and jsonb_typeof(item.value->'cast') = 'array' then
        for c in select value from jsonb_array_elements(item.value->'cast') loop
          select id into aid2 from artists where name = c.value->>'actor' order by id limit 1;
          if aid2 is null then
            insert into artists(name) values (c.value->>'actor') returning id into aid2;
          end if;
          insert into show_casts(show_id, artist_id, role)
          values (sid, aid2, coalesce(c.value->>'role',''))
          on conflict do nothing;
        end loop;
      end if;
    end loop;
  end if;

  new.applied := true;
  new.reviewed_at := now();
  new.review_note := coalesce(note, '已写入正式库');
  return new;
end $$;
create trigger trg_submissions_apply before update of status on submissions
  for each row when (new.status = 'approved') execute function apply_approved_submission();
```

> 说明：`shows` 的 `on conflict (date,time,city,musical,theatre)` 依赖 `DEPLOY.md` 里已有的唯一约束；如果正式导入时该约束导致冲突，先移除此约束、完成导入后再单独检查重复并按需恢复。

## 4. 数据迁移（必须三步走）

```powershell
# 1) 离线自检：行数 / 主键空值 / 外键孤儿 / 随机样本
python migrate_supabase.py --dry-run

# 2) 正式导入（需 .env 中的 SUPABASE_URL / SUPABASE_SERVICE_KEY）
python migrate_supabase.py

# 3) 导入后核对：与 Supabase 比对行数、主键、外键、抽样
python migrate_supabase.py --verify
```

- 任何一步不一致，都必须排查后重跑，不能直接进入下一步。
- 脚本按主键 upsert（`resolution=merge-duplicates`），断线可重跑；`show_casts` / `actor_roles` 等无主键表为普通插入，重跑前先确认没有重复。

## 5. 前端接入（现有原生前端，不改框架）

- 打开已生成的 [web/supabase_config.js](../web/supabase_config.js)，填入你的 anon key：

  ```js
  window.MG_SUPABASE = {
    url: "https://<project-ref>.supabase.co",
    anonKey: "eyJ...anon key...",
    timeoutMs: 8000
  };
  ```

- 在 `web/index.html` 的 `data_loader.js` 之前引入该配置，并让数据层优先走 Supabase：
  - 分页读取 `relation_types / artists / musicals / roles / actor_roles / relations / moments / groups / group_members / shows / show_casts / co_work_edges`；
  - 组装成现有 `window.MUSIC_GRAPH` 结构，前端 `app.js` 尽量不改；
  - 请求方式：`fetch(url + "/rest/v1/表名?...", { headers: { apikey: anonKey, Authorization: "Bearer " + anonKey } })`；
  - 失败时回退到 `web/data.js` 静态快照；`?mode=static` 强制离线。
- Contribute 与“演出排期批量上传”：
  - 提交统一 `POST /rest/v1/submissions`，body 含 `submission_type`、结构化字段、`details`（对象/数组）、`source_url`、`client_id`（浏览器生成 UUID）；
  - 批量排期使用 `submission_type = 'schedule_submission'`，`details` 为排期数组（date/time/city/musical/theatre/cast）；
  - 提交成功后显示“已进入待审核”，失败仍走演示模式本地保存，但不混入正式数据。

## 6. 管理员审核（第一版用 Supabase Studio）

1. 登录 Supabase → SQL Editor 完成第 3 节 SQL；
2. 打开 Table Editor → `submissions` → 筛选 `status = pending`；
3. “通过”：把 `status` 改为 `approved` 并保存，触发器自动入库（重复执行也不会重复写）；
4. “拒绝”：把 `status` 改为 `rejected`，不会写任何正式表；
5. 浏览器刷新正式站即可看到审核通过的内容。

## 7. Cloudflare Pages 部署

- 方式 A（推荐，Git 自动部署）：把仓库推到 GitHub → Cloudflare Pages → Create project → 连接 GitHub 仓库 → Build command 留空、Build output directory 填 `web` → Deploy。
- 方式 B（本地上传）：
  ```powershell
  npx wrangler pages deploy web --project-name musicalgraph
  ```
- HTTPS 由 Cloudflare 自动提供；绑定自定义域名在 Pages 的 Custom domains 里加，并确保 DNS 走 Cloudflare。
- 不需要任何服务器端环境变量；`web/supabase_config.js` 里的 anon key 是公开配置。

## 8. Keepalive（可选，默认不启用）

- Supabase Free 有“长时间无活动项目挂起”的政策；2026-08 起先观察实际行为，暂不作为上线依赖。
- 仓库已提供禁用模板 `.github/workflows/keepalive.yml.disabled`；若之后需要启用：
  1. 重命名为 `keepalive.yml`；
  2. 在 GitHub 仓库设置 `MG_SITE_URL` 变量与 `SUPABASE_ANON_KEY` Secret；
  3. 推送到默认分支即可（也可手动 Run workflow 测试）。

## 9. 验收清单（上线前逐项过）

- [ ] `python migrate_supabase.py --dry-run` 通过；`--verify` 全部一致
- [ ] `node web/verify.js` 全回归通过
- [ ] 正式站线上：搜索、图谱、详情、作品、团体、精彩片段正常（数据来自 Supabase）
- [ ] Contribute 提交 → Studio pending → approve → 页面刷新可见
- [ ] 同一提交重复 approve 两次，正式表不出现重复数据
- [ ] 快速连续提交同一内容，防重/限流生效
- [ ] 批量排期上传解析预览 → 提交 → 审核 → `shows/show_casts` 入库
- [ ] anon key 实测：可读公开表、可插 submissions、不可改正式表
- [ ] 仓库与前端产物中搜不到 service role key
- [ ] 手机尺寸检查通过

## 10. 回退与备份

- 本地 `music_graph.db` 继续保留，作为离线真实数据源；`web/data.js` 静态快照保留为回退。
- Supabase 免费版数据库自动备份保留 7 天；也建议上线前手动 `data/backups/` 导出一次。
- 如需转回国内云服务器：按 `archive/pocketbase/README.md` 恢复 PocketBase，数据仍可回写 SQLite。