# MusicGraph — 音乐剧演员关系图谱

音乐剧演员关系图谱网站：粉丝可以搜索演员、探索演员之间的关系网络，并共同补充、维护音乐剧行业人物资料。

数据来源：y.saoju.net API（演出排期）+ 手动整理（档案/CP/团体）。

## 技术栈

| 层 | 技术 | 状态 |
|---|---|---|
| 数据采集/处理 | Python 3.13（requests + networkx）+ SQLite | ✅ 已完成 |
| 前端 | Next.js + React | ⏳ 规划中 |
| 关系图 | Cytoscape.js | ⏳ 规划中 |
| 数据库 | Supabase（当前 SQLite 单文件） | ⏳ 规划迁移 |
| 部署 | Vercel | ⏳ 规划中 |

## 如何运行

当前是纯数据项目（尚无网页），常用操作：

```bash
# 每日自动同步（计划任务 MusicGraphSync，每日 6:00）
python sync.py

# 查看档案缺口（按剧目数排序）
python check_gaps.py

# 查看演员档案
python -c "import sqlite3; c=sqlite3.connect('music_graph.db'); print(c.execute('SELECT * FROM artists WHERE name=\"刘令飞\"').fetchall())"

# 导入演员资料（tab 分隔，修改脚本内 raw 字符串后运行）
python import_profiles_v3.py
python import_from_file.py
```

依赖：Python 3.13，`pip install requests networkx`

## 部署

尚未上线。V1 目标是部署到 Vercel + Supabase，做成可搜索、可看关系图、可提交补充的真实网站。

## 文档导航

- `AGENTS.md` — Codex 工作指令与项目总览（精简版）
- `PROJECT_RULES.md` — 通用工作原则（继承全局版）
- `docs/AI_CONTEXT.md` — 给 AI 的完整项目上下文
- `docs/TODO.md` — 待办事项（按优先级）
- `docs/LESSONS.md` — 经验沉淀