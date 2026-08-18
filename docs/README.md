# MusicalGraph — 音乐剧演员关系图谱

音乐剧演员关系图谱网站：粉丝可以搜索演员、探索演员之间的关系网络，并共同补充、维护音乐剧行业人物资料。

数据来源：y.saoju.net API（演出排期）+ 手动整理（档案/CP/团体）。

## 线上 Demo（2026-08-18 上线准备中）

- 上线名称：**MusicalGraph**（GitHub 公开仓库 `Essie363/MusicalGraph`，Vercel 托管 `web/` 目录）
- 链接：部署完成后在此填写（预计 `https://musicalgraph.vercel.app`）
- 当前为纯静态演示版：数据打包在 `web/data.js`，无需后端即可体验搜索、关系图谱、演员详情、作品、团体与精彩片段。
- 提交功能为「后端优先 + 演示模式兜底」：没有后端时内容保存在访客浏览器本地并显示成功提示，接入后端后自动走真实提交。

## 技术栈

| 层 | 技术 | 状态 |
|---|---|---|
| 数据采集/处理 | Python（SQLite 为主，同步需 requests） | ✅ 已完成 |
| 前端 MVP | HTML/CSS/JS（零依赖，`web/`，桌面+手机可用） | ✅ 已完成 |
| 前端（正式版） | Next.js + React | ⏳ 规划中 |
| 关系图 | Cytoscape.js | ⏳ 规划中 |
| 数据库 | Supabase（当前 SQLite 单文件） | ⏳ 规划迁移 |
| 部署 | Vercel | ⏳ 规划中 |
| 后端（本地） | PocketBase（单文件，自带数据库与管理后台） | ✅ 已集成（2026-08-12） |

## 如何运行

### 打开网页（最快体验）

双击 `web/index.html` 即可在浏览器打开关系图谱（无需服务器、无需联网）。

### 后端（PocketBase）

如何使用详见 [POCKETBASE.md](POCKETBASE.md)。简版：

```bash
powershell -ExecutionPolicy Bypass -File setup_pocketbase.ps1   # 首次安装：下载 + 建管理员
start_all.bat                                   # 一键启动：后端 8090 + 网页 8080
python import_pocketbase.py                     # 导入现有数据
# 管理员后台: http://127.0.0.1:8090/_/  （审核提交）
python apply_pocketbase.py                     # 已审核内容回写本地库（可选）
```

### 数据更新后一键刷新

```bash
python refresh_all.py   # 刷新 data/snapshot_*.csv 快照 + web/data.js 网页数据
```

### 一键回归验证（改完网页/数据后跑）

```bash
node web/verify.js   # 自动检查 13 项核心功能（需本机 Chrome）
```

### 常用数据操作

```bash
# 每日自动同步（原计划任务 MusicGraphSync 每日 6:00，2026-08-07 确认当前任务不存在）
python sync.py

# 查看档案缺口（按剧目数排序）
python check_gaps.py

# 查看演员档案
python -c "import sqlite3; c=sqlite3.connect('music_graph.db'); print(c.execute('SELECT * FROM artists WHERE name=\"刘令飞\"').fetchall())"

# 生成档案补齐模板（Excel 可打开填写，填好后告知我来导入）
python make_profile_template.py

# 导入演员资料（tab 分隔，修改脚本内 raw 字符串后运行）
python import_profiles_v3.py
python import_from_file.py
```

依赖：Python 3（同步脚本用 requests；其余脚本尽量用标准库）

## 部署

当前进展（2026-08-18）：静态前端 Demo 已准备上线 —— GitHub 公开仓库 `Essie363/MusicalGraph` + Vercel（Root Directory = `web`）。数据更新后运行 `python refresh_all.py` 再推送即可自动部署。

V1 正式版目标仍是 Vercel + Supabase（详见 [DEPLOY.md](DEPLOY.md)）；PocketBase 保持本地联调用途（见 POCKETBASE.md）。

## 文档导航

- `AGENTS.md` — Codex 工作指令与项目总览（精简版）
- `PROJECT_RULES.md` — 通用工作原则（继承全局版）
- `docs/AI_CONTEXT.md` — 给 AI 的完整项目上下文
- `docs/TODO.md` — 待办事项（按优先级）
- `docs/DEPLOY.md`
- `docs/POCKETBASE.md` — 本地后端使用指南
- `docs/后端操作指南.md` — 后端操作指南（小白版）：你现在要做的每一步 — 上线部署指南（Supabase + Next.js + Vercel）
- `docs/LESSONS.md` — 经验沉淀
