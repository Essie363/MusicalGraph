# LESSONS — 经验沉淀

> 记录遇到的问题、已验证的方案、不推荐的做法、技术约定、易错点。
> 规则：同一问题出现两次以上时，必须沉淀到本文件。
> 更新时间：2026-08-07

## 已验证的方案（可以继续用）

- **y.saoju.net API 增量同步**：按日期逐天探测（`/api/search_day/?date=YYYY-MM-DD`），只拉取未入库的日期，重跑成本低（`sync.py` 的 HORIZON_DAYS=420、EMPTY_STREAK_LIMIT=45 参数已验证）。
- **共演边机器推导**：从 `show_casts` 按场次两两配对 + 按剧目累计 `co_musical_count`，`graph_utils.recompute_co_work_edges()` 全量重建稳定可靠。
- **SQLite 单文件**：无需安装数据库服务，个人项目足够用；CSV 快照导出 UTF-8-BOM，Excel 可直接打开。
- **同名演员歧义处理**：`unresolved_cast` 表记录同名候选，避免静默错误匹配。

## 遇到的问题 / 易错点

- ⚠️ **脚本硬编码绝对路径（重要教训）**
  - 大量脚本硬编码 `C:\Users\Hp\Documents\Default Project`，项目迁移到 E 盘后脚本仍指向旧位置，运行会写错数据库或找不到文件。
  - 教训：**路径应基于脚本所在目录推导（`os.path.dirname(__file__)`），不要硬编码盘符**。这与 PROJECT_RULES"项目自包含、可迁移"原则一致。
  - 待办：见 docs/TODO.md 高优先级第一项。

- **百度百科抓取有反爬（2026-08-07 更新）**：
  - `wapbaike.baidu.com` 偶尔触发验证码/拦截，需冷却重试，批量抓取要限速。
  - 2026-08-07 实测：`openapi/BaikeLemmaCardApi` 已失效（errno=2）、wapbaike 重定向到错误页、桌面版 `item/` 直接 403 —— 当前**自动抓取不可行**，勿再反复尝试浪费时间。
  - 替代路径：用户手动提供资料（`import_from_file.py` / 档案补齐模板）或换用其他公开数据源。

- **中文编码问题**：CSV/JSON 必须显式指定 `encoding="utf-8"`；CSV 导出用 UTF-8-BOM 防 Excel 乱码。中文数据写入丢失编码的问题在其他项目出现过（见 D:\codex_workspace 经验），写入中文数据后务必验证。

- **relations 状态字段**：现有 CP 关系全部为 `approved`，后续用户提交必须走 `pending → approved/rejected` 审核流，不能直接 approved。

## 不推荐的做法

- 不推荐硬编码任何盘符/绝对路径（违反项目可迁移原则）。
- 不推荐引入重型框架/依赖——个人长期维护优先，简单优先。

## 技术约定

- 所有 Python 脚本保持 UTF-8。
- 数据变更脚本应幂等（可重复运行不产生脏数据）。
- 修改完数据后如涉及共演关系，重新运行共演边重算。