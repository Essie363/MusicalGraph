# AI_CONTEXT — MusicGraph 项目上下文（给 AI 阅读）

> 本文档是项目的核心 AI 上下文。开始工作前请先读本项目 `AGENTS.md`、根目录 `PROJECT_RULES.md` 和本文档。
> 设计原则：**优先简单、避免过度设计、适合个人长期维护、减少依赖。**

## 1. 项目背景

做一个**音乐剧演员关系图谱网站**，让粉丝可以探索演员之间的关系，并共同补充、维护音乐剧行业人物资料。

数据来源：
- y.saoju.net API（演出排期，可直连）
- 手动整理（演员档案 / CP / 团体）

## 2. 当前目标（V1）

**做出一个可以搜索演员、查看关系、提交补充，并真实上线运行的网站。**

V1 核心功能：
1. 演员关系星图（搜索演员 → 可视化关系网络 → 点击展开 → 关系类型）
2. 关系详情（关系类型 / 共同作品 / 相关资料）
3. 用户共建（添加演员、补充关系、修正资料 → 提交 → 审核 → 入库）

## 3. 技术选型（全部免费）

| 层 | 技术 |
|---|---|
| 前端 | Next.js + React |
| 关系图 | Cytoscape.js |
| 数据库 | Supabase（现状：SQLite 单文件，待迁移） |
| 部署 | Vercel |

架构：`网页 → Next.js → Cytoscape.js（关系图）→ Supabase（数据库）`

## 4. 已完成 / 进行中 / 下一步

### 已完成
- [x] 演出数据库搭建（34,993 场 / 152,235 条卡司）
- [x] 共演边机器计算（48,343 对）
- [x] 每日自动同步（计划任务 MusicGraphSync，每日 6:00）
- [x] 百度百科自动抓取（部分成功，44 人）
- [x] 手动档案导入（213 人有资料，覆盖率约 9%）
- [x] note 字段拆分为 major + nickname + note
- [x] CP 关系入库（123 条，type=cp；couple 真实情侣暂空）
- [x] 团体表建设（33 个团体 / 69 人次）
- [x] 同学关系自动推导（同校 + 同 enrollment_year，70 对入库）
- [x] 前端 MVP（`web/`：搜索演员/作品 + 关系图 + 档案面板 + 共同作品/参演剧目/作品演员表，零依赖离线可跑）
- [x] 前端移动端支持（触摸操作 + 响应式布局）
- [x] 前端首屏优化（热门演员快捷入口 + 自动聚焦）
- [x] 前端关系类型筛选（点击图例切换）
- [x] 前端角色展示（参演剧目/作品演员表带角色名）
- [x] 前端团体视图（搜索团体/成员列表/所属团体）
- [x] 数据质量审计（无脏数据；前端合并同对多名 CP）
- [x] 百科档案合并（merge_baike.py，19 条；uncovered_actors.csv 已更新为 883 人）
- [x] 快照导出脚本（snapshot_export.py → data/snapshot_*.csv）

### 进行中
- 无（文档体系建设中）

### 下一步（详见 TODO.md）
- ~~修复脚本硬编码路径问题~~（已完成：所有脚本改为基于自身目录，数据 `*_raw.json` 已入 `data/api_raw/`）
- 继续补演员档案（覆盖率约 9%；`data/uncovered_actors.csv` 已更新，最活跃缺口：牛博为/周波/温升宝）
- ~~同学关系自动推导~~（已完成，70 对入库）
- SQLite → Supabase 迁移
- Next.js 前端搭建（在 `web/` MVP 基础上升级：搜索 + 演员页 + 关系详情页）
- Cytoscape.js 图谱可视化
- 用户系统 + 审核工作流（relations.status: pending → approved/rejected）
- Vercel 部署上线

## 5. 数据库核心表（music_graph.db，约 14MB）

### artists（演员档案，4,532 行）
`id | name | nickname | birth_date | major | school | hometown | enrollment_year | height | note | is_actor`

### shows / show_casts（演出排期）
`shows: id | date | time | city | musical | theatre`（34,993 场）
`show_casts: show_id | artist_id | role`（152,235 条）

### co_work_edges（共演边，机器推导，48,343 对）
`actor_a | actor_b | co_show_count | co_musical_count | first_co_date | last_co_date`

### relations（用户关系，193 条）
`type_id | actor_a | actor_b | detail | source_type | status`
- type_id → relation_types：cp（粉丝组合）/ classmate / friend / teacher_student / same_company / co_work / couple（真实情侣，暂空）
- source_type：user | derived | media | official
- status：pending | approved | rejected（现有 CP 均为 approved）

### groups + group_members（33 个 / 69 人次）
`groups: id | name | type (enrollment/cohort/other)`

### 预留表（空）
`users`、`review_logs`（为 web 平台预留）

### 辅助表
`sync_log`（同步记录）、`unresolved_cast`（同名演员歧义待人工确认）

## 6. 目录与关键文件

- `music_graph.db` — 主数据库（SQLite）
- `data/` — 快照 CSV、团体/CP 标签、百科抓取 JSON、演出缓存、活跃度排序
- `sync.py` — 每日增量同步（基础表全量刷新 + 排期按日期增量拉取 + 共演边重算）
- `run_sync.bat` — 计划任务入口
- `graph_utils.py` — 共演边重算模块
- `check_gaps.py` — 档案缺口查询
- `import_*.py` — 档案/CP 导入脚本
- `merge_baike.py` — 百科 JSON 合并入库
- `snapshot_export.py` — 导出 data/snapshot_*.csv 快照
- `make_profile_template.py` — 生成档案补齐模板
- `fetch_baike.py` — 百度百科抓取（当前被反爬拦截）
- `refresh_all.py` — 一键刷新：快照 + 网页数据
- `fix_note.py` / `fix_cp.py` — 数据修正脚本

## 7. 注意事项

- 所有脚本路径基于自身目录（`Path(__file__).resolve().parent`），项目可整体移动；API 原始快照存放在 `data/api_raw/`。
- SQLite 单文件，无需数据库服务
- y.saoju.net API 可直连；`wapbaike.baidu.com` 偶尔触发反爬验证，需冷却
- 所有 CSV 导出使用 UTF-8-BOM，Excel 可直接双击打开
- 后续用户贡献需走 `pending → approved/rejected` 审核流