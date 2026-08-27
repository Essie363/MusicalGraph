# Supabase 迁移成本评估

> 2026-08-23 · `codex/backend-eval` 分支
> 问题：如果不用 PocketBase 也不自建 Cloudflare 后端，把项目迁到 Supabase 要花多少时间、难度多大？
> 本文件只做评估，不写代码。

## 一、结论

- Supabase 是现成的“数据库 + REST API + 用户认证 + 管理后台（Dashboard）”，**不需要自建后端服务**。它和 Cloudflare 自建方案不一样：Cloudflare 大部分后端代码要自己写，Supabase 大部分底层能力已经免费给你了。
- 本项目已经有一版可用的迁移脚本 `migrate_supabase.py` 和建表 SQL（见 `docs/DEPLOY.md`），这部分成本基本已经“预付”过。
- 最小可用版（数据迁过去 + 前端读 Supabase + 用户提交 + 管理员审核入正式库）预计 **0.5-1 个工作日**；完整版（含批量排期提交、审核日志、用户注册、备份恢复、正式上线维护）约 **1-1.5 周**。
- 难度：**比自建 Cloudflare 后端低**。主要难点不再是“写后端”，而是 RLS 权限规则、审核自动入库逻辑放哪里、以及前端数据层改造。

## 二、Supabase 替我们做了什么

| 角色 | Supabase 提供 | 还需要自己做 |
|---|---|---|
| 数据库 | 托管 Postgres（免费额度足够本项目） | 几乎没有 |
| API | PostgREST 自动生成 `/rest/v1/*` REST 接口 | 前端数据层改为调用它 |
| 认证 | Supabase Auth（邮箱+密码开箱即用） | 管理员/普通用户角色区分（RLS + claim） |
| 管理后台 | Supabase Studio 网页控制台（像 PocketBase 的 `/_/`） | 初期可直接在 Studio 审核，后期可做一个自己的 admin 页面 |
| 审核逻辑 | 无（需要自己实现） | 用 SQL 触发器/函数，或一个小型 Edge Function |
| 数据迁移 | 无 | `migrate_supabase.py` 已写好了大部分 |
| 备份 | 免费版自动备份（保留 7 天） | 本地定期导出 |

## 三、现有家底（这会显著降低工作量）

1. **建表 SQL 已存在**：`docs/DEPLOY.md` 第 1 步已给出 `relation_types / artists / musicals / roles / actor_roles / shows / show_casts / co_work_edges / relations / groups / group_members / review_logs` 全部建表语句。
2. **迁移脚本已存在**：`migrate_supabase.py`（4.7 KB，纯标准库），按依赖顺序批量导入，支持 `--dry-run` 离线自检，按主键 upsert（幂等）。
3. **环境变量模板已存在**：`.env.example` 已写好 `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` 等。
4. **上线方案已写过一遍**：`docs/DEPLOY.md` 的路线就是“Vercel/静态版 + Supabase + 可选 Next.js”，文档比 Cloudflare 方案成熟得多。

## 四、还需要新建的零件（按工作量从大到小）

### 1. 审核自动入库逻辑（约 0.5 天）
- PocketBase 里这段逻辑在 `pb/pb_hooks/main.pb.js`（约 250 行）。Supabase 有两种放法：
  - 简单：写一个 Postgres 函数 + 触发器，管理员在 Studio 把 `status` 改成 `approved`，触发器自动写正式表——和 PocketBase 钩子几乎一一对应；
  - 或写一个很小的工作流接口（Edge Function），管理员页面调它来“通过”。
- 推荐先做触发器方案，代码量最少，也不需要自己部署服务。

### 2. 前端数据层改造（约 0.5 天）
- 现在 `web/data_loader.js` 调 PocketBase 的 `/api/collections/*/records`。Supabase 的接口是 `/rest/v1/*`，分页/字段写法不同。
- 需要写一个 `web/supabase_loader.js`（或改 `data_loader.js`）：健康检查、分页读 5 个集合、组装成现有 `window.MUSIC_GRAPH` 结构，失败时继续回退静态快照。
- 提交部分把 `POST submissions` 改成 Supabase 的 insert（带 anon key）；批量排期上传的前端解析不用动，只改提交目标。

### 3. 提交表（约 2-4 小时）
- `DEPLOY.md` 的 SQL 还没有通用 `submissions` 表（它把关系提交直接写进 relations）。为兼容现有四类提交（演员/剧目/关系/精彩片段），需要补一张 `submissions` 表，字段照搬 PocketBase 的 `0001_init.js` 即可。
- 同时补 RLS：`submissions` 允许匿名插入但只允许管理员读/改；正式表公开读、仅管理员写。

### 4. 管理员角色与审核入口（约 0.5 天）
- 初期最简单：**直接使用 Supabase Studio 当审核后台**（登录控制台 → submissions → 筛选 pending → 改 status）——和现在用 PocketBase `/_/` 几乎一样，可以先不写页面。
- 之后再做一个自己的 `/admin` 页面（邮箱登录 + pending 列表 + 通过/驳回），需要区分管理员：可在 `profiles`/`admins` 表里标记，或用 Auth 自定义 claim。

### 5. 数据导入与回归（约 2-4 小时，可并行）
- 跑 `python migrate_supabase.py --dry-run` 核对行数，再正式导入。
- 注意 `shows`（34,993 场）+ `show_casts`（15.2 万条）是最大的两张表，脚本每批 500 行通过 REST 导入，预计几分钟到十几分钟；失败可重跑（主键 upsert）。
- 跑 `node web/verify.js` 回归，确保前端数据层切换后图谱、搜索、详情页正常。

## 五、时间与难度汇总

| 方案 | 最小可用版 | 完整版 | 难度 |
|---|---|---|---|
| Supabase 迁移 | 0.5-1 天 | 1-1.5 周 | 低-中 |
| Cloudflare 自建 | 1-2 天（8-16 小时） | 1-2 周 | 中 |
| 继续 PocketBase（本地） | 已可用 | 无法直接上线 Cloudflare | 最低 |

Supabase 最快的原因：数据库、REST API、认证、控制台全是现成的，现有脚本文档也齐全；Cloudflare 把这些全部变成自己要写的代码。

## 六、需要小心的点

- **RLS 不要写错**：anon key 是公开的，读接口开放没问题，但写接口和审核接口必须被权限规则挡住。service_role key 只能放在服务端/本机脚本里，绝不能进前端。
- **审核逻辑放在哪**：触发器写错会连锁影响数据库；建议先在本地 SQL Editor 小样本测，再放到正式库。
- **大表导入先 `--dry-run`**：确认行数与本地一致，避免半途失败留下脏数据。
- **同步链路**：现在每天的数据是本地 `sync.py` → `web/data.js`。迁到 Supabase 后，要么继续“本地同步后跑 import 脚本更新 Supabase”，要么以后上 GitHub Actions 定时执行导入。
- **免费额度**：Supabase 免费版对当前数据量足够（数据库约 500MB，本项目 SQLite 才 14MB；备份保留 7 天）。具体数字以官方页面为准。

## 七、建议

- 如果目标是**尽快上线一个“能提交、能审核、能展示”的网站**，选 Supabase，因为它把最麻烦的认证、数据库、后台都包好了，文档也是现成的。
- 如果目标就是**把整个项目放在 Cloudflare 上、所有逻辑自己可控**，那才值得走 Cloudflare 自建。
- 两者可以先不互斥：网页继续用静态版托管（Vercel/Pages/Cloudflare 都行），后端数据用 Supabase；以后想换 Cloudflare 时，再迁移数据库和接口。

## 八、假设

- 迁移范围按“正式数据 + 提交审核流”理解；不包含用户注册系统（先做单管理员）。
- 审核入口初期用 Supabase Studio，不自建复杂后台。
- “Supabase 迁移”指把现有 SQLite/PocketBase 数据搬到 Supabase，前端仍用现有 `web/` 静态站（不先做 Next.js）。
