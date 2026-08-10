# DEPLOY — MusicGraph 上线部署指南

> 目标：把当前本地可跑的关系图谱网站（`web/` MVP + SQLite）升级为**真实上线网站**。
> 技术栈：Next.js + React + Supabase + Vercel（全部免费）。
> 前置条件：注册两个免费账号（各约 2 分钟）：
> - [Supabase](https://supabase.com)（数据库 + 用户系统）
> - [Vercel](https://vercel.com)（网站托管，可用 GitHub 登录）

---

## ⚡ 快速通道：先上线静态版（今天就能拿到公网链接）

> 你不需要等 Supabase/Next.js，`web/` 里的静态网页（HTML/CSS/JS，零依赖）可以**直接部署**，
> 几分钟后就能得到公开链接，先让朋友看到效果。

### 方式 A：Netlify Drop（最简单，无需命令行）

1. 打开 <https://app.netlify.com/drop>（用邮箱或 GitHub 免费注册/登录）
2. 把 **`E:\AI VibeCoding Project\MusicGraph\web` 文件夹** 直接拖进浏览器页面
3. 几秒后部署完成，你会得到类似 `https://xxx.netlify.app` 的链接
4. 数据更新后：重新运行 `python refresh_all.py`，再次拖入 `web` 文件夹即可（或以后接 Git 自动部署）

### 方式 B：Vercel（推荐，以后正式版也用这个平台）

1. 注册 <https://vercel.com>（用 GitHub 登录最方便）
2. 安装 CLI 后执行：
   ```bash
   cd E:/AI VibeCoding Project/MusicGraph
   npx vercel deploy web --prod
   ```
3. 得到 `https://xxx.vercel.app` 链接

> 说明：静态版数据是"打包"在网页里的（`web/data.js`），数据库更新后要重新 `refresh_all.py` 再部署；
> 正式版（第 3-5 步）接上 Supabase 后数据实时同步，就不需要重新部署了。

---

## 第 0 步：准备工作（需要你做）

1. 注册 Supabase → 创建一个新项目（记下 **Project URL** 和 **anon public key**，在 Settings → API）
2. 注册 Vercel → 用 GitHub 账号登录（没有 GitHub 就先注册一个）
3. 把本项目推到 GitHub：
   ```bash
   git remote add origin https://github.com/<你的用户名>/MusicGraph.git
   git branch -M main
   git push -u origin main
   ```

---

## 第 1 步：Supabase 建表（数据库迁移）

在 Supabase 控制台 → SQL Editor 里执行下面的 SQL（已按本项目 SQLite 表结构转换，含外键与索引）。

```sql
-- relation_types（关系类型）
create table relation_types (
  id serial primary key,
  code text unique not null,
  name text not null,
  is_builtin boolean default false,
  description text
);
insert into relation_types (code,name,is_builtin,description) values
  ('co_work','共演',true,null),
  ('classmate','同学',true,null),
  ('friend','好友',true,null),
  ('couple','情侣',true,'现实中的真实情侣关系（当前暂无数据）'),
  ('teacher_student','师生',true,null),
  ('same_company','同公司',true,null),
  ('cp','CP',true,'粉丝组合/CP名');

-- artists（演员档案）
create table artists (
  id integer primary key,
  name text not null,
  nickname text,
  birth_date text,
  major text,
  school text,
  hometown text,
  enrollment_year text,
  height text,
  note text,
  is_actor boolean default true
);
create index idx_artists_name on artists(name);

-- musicals / roles / actor_roles（剧目与角色）
create table musicals (
  id integer primary key,
  name text not null,
  is_original boolean,
  progress text,
  premiere_date text,
  info text
);
create table roles (
  id integer primary key,
  musical_id integer references musicals(id),
  name text
);
create table actor_roles (
  artist_id integer references artists(id),
  musical_id integer references musicals(id),
  role_id integer references roles(id)
);
create index idx_actor_roles_artist on actor_roles(artist_id);
create index idx_actor_roles_musical on actor_roles(musical_id);

-- shows / show_casts（演出排期）
create table shows (
  id serial primary key,
  date text, time text, city text, musical text, theatre text,
  unique(date,time,city,musical,theatre)
);
create table show_casts (
  show_id integer references shows(id),
  artist_id integer references artists(id),
  role text
);
create index idx_show_casts_show on show_casts(show_id);
create index idx_show_casts_artist on show_casts(artist_id);

-- co_work_edges（共演边，机器推导）
create table co_work_edges (
  actor_a integer not null references artists(id),
  actor_b integer not null references artists(id),
  co_show_count integer default 0,
  co_musical_count integer default 0,
  first_co_date text,
  last_co_date text,
  primary key (actor_a, actor_b)
);

-- relations（用户关系：cp/classmate/couple 等）
create table relations (
  id serial primary key,
  type_id integer not null references relation_types(id),
  actor_a integer not null references artists(id),
  actor_b integer not null references artists(id),
  detail text,
  source_type text not null default 'user',   -- user | derived | media | official
  source_url text,
  evidence text,
  status text not null default 'pending',     -- pending | approved | rejected
  confidence real,
  submitted_by integer,                        -- 关联 auth.users
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index idx_relations_pair on relations(actor_a, actor_b);
create index idx_relations_status on relations(status);

-- groups / group_members（团体）
create table groups (
  id serial primary key,
  name text unique not null,
  type text not null default 'cohort'          -- enrollment | cohort | other
);
create table group_members (
  group_id integer references groups(id),
  artist_id integer references artists(id),
  unique(group_id, artist_id)
);

-- review_logs（审核日志）
create table review_logs (
  id serial primary key,
  relation_id integer references relations(id),
  action text,                                 -- approve | reject
  reviewer uuid,                               -- auth.users id
  comment text,
  created_at timestamptz default now()
);
```

> 说明：Supabase 自带的 `auth.users` 表替代本地的 `users` 预留表，无需手动建。

---

## 第 2 步：导入现有数据

项目已自带迁移脚本 **`migrate_supabase.py`**（纯标准库，支持 `--dry-run` 离线自检）。它会从 `music_graph.db` 读出各表，用 Supabase REST API 分批导入（按依赖顺序：relation_types → artists → musicals/roles/actor_roles → groups → shows/show_casts → co_work_edges → relations，保留原 id 保证外键一致）：

1. `relation_types`（7 条）
2. `artists`（4532 条，分批 500/次）
3. `musicals`（515 条）、`roles`、`actor_roles`
4. `shows`（34993 条，分批 500/次）、`show_casts`
5. `co_work_edges`（48343 条，分批）
6. `relations`（193 条）、`groups`、`group_members`

> 注意：`shows` 在 SQLite 中 `id` 是自增主键，`show_casts.show_id` 引用它；迁移时保持 id 一致或重建映射。建议保留原 id（Supabase `serial` 支持显式插入 id）。

环境变量（**不要提交到 Git**）：
```bash
# Windows PowerShell
$env:SUPABASE_URL="https://xxxx.supabase.co"
$env:SUPABASE_SERVICE_KEY="eyJ..."   # Settings -> API -> service_role key（有写权限）

# 先离线自检（不联网）
python migrate_supabase.py --dry-run
# 确认行数无误后真正导入
python migrate_supabase.py
```

---

## 第 3 步：Next.js 项目搭建

在项目根目录建 `webapp/`（与现有 `web/` 静态 MVP 分开，避免混淆）：

```bash
npx create-next-app@latest webapp --typescript --tailwind --eslint
cd webapp
npm install cytoscape @supabase/supabase-js
```

### 页面结构

| 路由 | 功能 | 对应现有 web/ 逻辑 |
|---|---|---|
| `/` | 首页：搜索框 + 关系图谱 | `web/index.html` + `web/app.js` |
| `/actor/[id]` | 演员档案页（字段/关系/共同作品/参演剧目/所属团体） | 档案面板逻辑 |
| `/musical/[id]` | 作品页（演员表） | `showMusicalPanel` |
| `/group/[id]` | 团体页（成员列表） | `showGroupPanel` |
| `/search` | 搜索结果 | 搜索下拉逻辑 |

### 数据获取
- 用 `@supabase/supabase-js` 从 Supabase 读取（替代现在的 `web/data.js` 静态文件）
- 关系图数据：`relations` + `artists`（按需取，避免一次性拉 4532 人）
- 图谱组件：把 `web/app.js` 的力导向 Canvas 逻辑封装成 React 组件 `GraphView.tsx`，后续可替换为 Cytoscape.js（`react-cytoscapejs`）

### 环境变量（webapp/.env.local）
```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

---

## 第 4 步：用户系统 + 审核工作流（V1.5）

- **注册/登录**：Supabase Auth（邮箱密码即可，免费额度充足）
- **提交补充**：表单写 `relations` 时 `status='pending'`、`submitted_by=当前用户 id`；或 `artists` 补充字段走"修正建议"表（可选新增 `suggestions` 表）
- **管理员审核**：页面 `/admin`（仅 `role='admin'` 可见，通过自定义 JWT claim 或单独 admin 表判断），列出 pending 记录 → 通过/驳回 → 写 `review_logs` → 更新 `relations.status`

---

## 第 5 步：Vercel 部署

1. Vercel 控制台 → New Project → 选择 GitHub 上的 MusicGraph 仓库
2. Root Directory 填 `webapp`
3. Framework Preset 选 Next.js（自动识别）
4. 环境变量填 `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. Deploy → 完成，得到一个 `https://xxx.vercel.app` 地址

### 自定义域名（可选）
Vercel → Settings → Domains，绑定你自己的域名（如 `musicgraph.fans`）。

---

## 第 6 步：上线后维护

- **数据更新**：本地跑 `python sync.py` 更新 SQLite → 重跑 `migrate_supabase.py` 增量同步（或后续把同步任务也托管到云端，如 GitHub Actions 定时跑）
- **网页数据**：本地 `python refresh_all.py` 刷新快照；线上数据由 Supabase 实时提供，无需此步
- **备份**：Supabase 自带每日备份（免费版保留 7 天）；本地保留 `music_graph.db`

---

## GitHub 自动同步（2026-08-07）

- `.github/workflows/sync.yml`：每日北京时间 06:00 在 GitHub Actions 运行 `sync.py`（增量抓取 y.saoju.net 排期）+ `export_graph.py` + `refresh_all.py`，自动提交数据与网页文件；也可手动 Run workflow。
- 前置：将本仓库推送到 GitHub（`music_graph.db` 与 `web/data.js` 均已入库，可增量同步）。
- 用户提交闭环：Contribute 页提交 → 本地待审核列表（可导出 JSON / 复制为 Issue 文本，配置 `MG_GITHUB_REPO` 后可一键开 Issue）→ 开发者确认录入 → `python refresh_all.py` → 图谱自动同步。

## 附录：常见问题

- **Q：为什么不用 SQLite 直接部署？** Vercel 是无服务器环境，文件系统只读，SQLite 无法持久化；用户共建需要真正的数据库服务。Supabase 免费额度（500MB 数据库 + 5 万月活用户）对本项目绰绰有余。
- **Q：现有 `web/` 静态页怎么办？** 保留作为本地预览/原型；正式站用 `webapp/`。两者数据同源（Supabase）。
- **Q：Cytoscape.js 什么时候换？** 现有 Canvas 力导向已能满足 V1 展示；若需要更复杂布局/交互再引入 Cytoscape，接口上只需替换 `GraphView.tsx` 内部实现。
