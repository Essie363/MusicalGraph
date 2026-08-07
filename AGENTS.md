# MusicGraph — 音乐剧演员关系图谱

## 项目概述

做一个**音乐剧演员关系图谱网站**，让粉丝可以探索演员之间的关系，并共同补充、维护音乐剧行业人物资料。

数据来源：y.saoju.net API（演出排期）+ 手动整理（档案/CP/团体）。

---

## 产品需求

### V1 核心功能

**1. 演员关系星图（核心）**
- 搜索演员
- 查看演员关系网络（可视化图谱）
- 点击节点展开更多人物
- 查看关系类型（合作演员 / 同学 / 导演制作团队 / 作品关系）

**2. 关系详情**
- 两人关系类型
- 共同作品
- 相关资料

**3. 用户共建**
- 添加演员信息
- 补充关系
- 修正错误资料
- 提交后审核，再更新数据库

### 推荐技术方案（全部免费）

| 层 | 技术 | 用途 |
|---|---|---|
| 前端 | Next.js + React | 网页 + 用户系统 |
| 关系图 | Cytoscape.js | 演员关系网络可视化 |
| 数据库 | Supabase | 存储人物/作品/关系数据 |
| 部署 | Vercel | 免费上线 |

架构：`网页 → Next.js → Cytoscape.js（关系图）→ Supabase（数据库）`

### 第一阶段目标

**做出一个可以搜索演员、查看关系、提交补充，并真实上线运行的网站。**

---

## 目录结构

```
E:\AI VibeCoding Project\MusicGraph\
├── music_graph.db          ← 主数据库（SQLite，约 14MB）
├── data/
│   ├── snapshot_*.csv      ← 最新快照导出（由 snapshot_export.py 生成）
│   ├── group_cp_tags.json  ← 团体/CP 原始标签（177条，未分类）
│   ├── group_cp_classified.json ← 团体/CP 分类结果（group/cp 各归各类）
│   ├── profiles/           ← 百度百科抓取原始 JSON
│   ├── raw/                ← 演员演出 CSV 缓存
│   ├── uncovered_actors.csv ← 活跃但无档案的演员列表
│   └── actor_priority.json ← 演员活跃度排序
├── sync.py                 ← 每日自动同步脚本
├── run_sync.bat            ← Windows 计划任务调用的批处理
├── graph_utils.py          ← 共演边重算模块
├── check_gaps.py           ← 查询档案缺口
├── fix_note.py             ← note 字段拆分（专业/别名）
├── fix_cp.py               ← CP 关系补修脚本
├── import_cp.py            ← 导入 CP 关系到 relations 表
├── merge_baike.py          ← 合并百科 JSON 到 DB
├── snapshot_export.py       ← 导出 data/snapshot_*.csv 快照
├── web/verify.js             ← 前端一键回归验证（node web/verify.js）
├── make_profile_template.py  ← 生成档案补齐模板 data/profile_template.csv
├── fetch_baike.py            ← 百度百科抓取（2026-08 起被反爬拦截，暂不可用）
└── refresh_all.py             ← 一键刷新：快照 + 网页数据
```

## 数据库核心表

### artists（演员档案，4,532 行）

| 字段 | 说明 | 来源 |
|---|---|---|
| id, name | 主键、姓名 | y.saoju API |
| nickname | 昵称/别名 | 手动整理 |
| birth_date | 生日 | 百科+手动 |
| major | 专业 | 提取自 note |
| school | 毕业院校 | 百科+手动 |
| hometown | 籍贯 | 手动整理 |
| enrollment_year | 入学年份/年级 | 手动整理 |
| height | 身高(cm) | 手动整理 |
| note | 备注（公司/职务/个人描述） | 百科+手动 |
| is_actor | 是否演员 | 自动 |

**当前覆盖：约 202–213/2345 有演出记录的演员已有 ≥1 个档案字段（约 9%，口径视字段而定）**

### shows / show_casts（演出排期，34,993 场 / 152,235 条）
```
shows: id | date | time | city | musical | theatre
show_casts: show_id | artist_id | role
```

### co_work_edges（共演边，机器推导，48,343 对）
```
actor_a | actor_b | co_show_count | co_musical_count | first_co_date | last_co_date
```

### relations（用户关系，193 条）
```
type_id | actor_a | actor_b | detail | source_type | status
```
- type_id 对应 relation_types（cp=粉丝组合/classmate=同学/friend=好友/teacher_student=师生/same_company=同公司/co_work=共演/couple=真实情侣·待补充）
- source_type: user | derived | media | official
- status: pending | approved | rejected

### groups + group_members（团体，33 个 / 69 人次）
```
groups: id | name | type (enrollment/cohort/other)
group_members: group_id | artist_id
```

### relation_types（关系类型，6 种）
```
code: co_work | classmate | friend | couple | teacher_student | same_company
```

### 预留表（空，为 web 平台预留）
```
users: id | username | nickname | auth_method | role | created_at
review_logs: id | relation_id | action | reviewer | comment | created_at
relations 表已有 status 字段支持审核流（pending → approved/rejected）
```

## 常用命令

```bash
# 查看演员档案
python -c "import sqlite3; c=sqlite3.connect('music_graph.db'); print(c.execute('SELECT * FROM artists WHERE name=\"刘令飞\"').fetchall())"

# 查看共有多少档案缺口
python -c "import sqlite3; c=sqlite3.connect('music_graph.db'); r=c.execute('SELECT COUNT(*) FROM artists WHERE nickname IS NULL AND birth_date IS NULL AND school IS NULL AND hometown IS NULL AND enrollment_year IS NULL AND height IS NULL AND EXISTS(SELECT 1 FROM show_casts WHERE artist_id=artists.id)').fetchone(); print(r)"

# 查活跃但无档案的演员（按剧目数排）
python check_gaps.py

# 手动同步（通常不需要，计划任务每日 6:00 自动跑）
python sync.py

# 导入新的一批演员资料（tab 分隔格式）
# 修改 import_profiles_v3.py 或 import_from_file.py 中的 raw 字符串，然后运行
```

## 数据同步

- **计划任务**：`MusicGraphSync`，每日 6:00 执行 `run_sync.bat`
- **延迟同步**：`schtasks /run /tn MusicGraphSync`
- **删除任务**：`schtasks /delete /tn MusicGraphSync /f`
- **同步内容**：基础表全量刷新（artists/musicals/roles）+ 演出排期增量拉取 + 共演边重算

## 当前进度与待办

### 已完成
- [x] 演出数据库搭建（34,993 场，152,235 条卡司）
- [x] 共演边机器计算（48,343 对）
- [x] 每日自动同步
- [x] 百度百科自动抓取（部分成功，44 人）
- [x] 手动档案导入（213 人有资料）
- [x] note 字段拆分为 major + nickname + note
- [x] CP 关系入库（123 条，type=cp 粉丝组合；couple 真实情侣暂空待补充）
- [x] 团体表建设（33 个团体，69 人次）

### 待完成
- [ ] 继续补演员档案（覆盖率仅 9%，参见 `uncovered_actors.csv`）
- [x] 同学关系自动推导（同校 + 同 enrollment_year，2026-08-07 完成，70 对已入库，脚本 classmate_derive.py）
- [x] 前端 MVP（2026-08-07：web/ 搜索演员/作品 + 关系图 + 档案面板 + 共同作品/参演剧目/作品演员表，零依赖离线可跑）
- [x] 前端移动端支持（2026-08-07：触摸平移/拖拽/双指缩放 + 响应式布局，手机可用）
- [x] 前端首屏优化（2026-08-07：热门演员快捷入口 + 自动聚焦）+ 一键刷新脚本 refresh_all.py
- [x] 前端关系类型筛选（2026-08-07：点击图例切换显示 情侣/同学 等关系类型）
- [x] 前端团体视图（2026-08-07：搜索团体 → 成员列表 → 点击跳转演员，档案显示所属团体）
- [x] 数据质量审计（2026-08-07：确认无脏数据；同名演员 15 组为合理多义；前端合并同对多名 CP）
- [x] 百科档案合并（2026-08-07：merge_baike.py 合并 19 条百科数据，uncovered_actors.csv 已更新）
- [x] 快照导出脚本（2026-08-07：snapshot_export.py 统一导出 data/snapshot_*.csv，relations 含同学/情侣分类）
- [ ] 将 SQLite 数据迁移到 Supabase
- [ ] Next.js 前端搭建（搜索 + 演员页 + 关系详情页）
- [ ] Cytoscape.js 关系图谱可视化
- [ ] 用户系统 + 审核工作流（用户提交 → 管理员审核 → 入库）
- [ ] Vercel 部署上线

## 注意事项

- SQLite 单文件，无需安装数据库服务
- Python 3.13 环境，需 requests + networkx 库
- y.saoju.net API 可直连，`wapbaike.baidu.com` 偶尔触发反爬验证，需冷却
- 所有 CSV 导出使用 UTF-8-BOM，Excel 可直接双击打开
- relations 表的 `status` 字段目前 CP 关系都标记为 `approved`，后续用户贡献需走 `pending → approved/rejected`
