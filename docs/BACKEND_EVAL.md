# 自建后端方案评估（Cloudflare）

> 2026-08-23 · `codex/backend-eval` 分支
> 问题：现在后端是本地 PocketBase。用户希望以后部署到 Cloudflare，而 PocketBase 不能直接运行在 Cloudflare 上。
> 本文件只做评估，不写代码。

## 一、结论

- PocketBase 确实**不能直接放上 Cloudflare**：它是一个独立的 Go 程序 + 本地 SQLite 文件 + 自带管理后台，需要常驻进程，与 Cloudflare Workers（无服务器、函数式执行）不兼容。
- 但现有系统很小，**自己重写一个“反馈审核后端”是可行且合理的**，难度属于“中等偏低”。
- 如果只做 MVP（用户提交 + 管理员审核 + 自动入库 + 前端读接口），大约 **1-2 个工作日**；如果还带上用户账号、审核日志、完整管理页面、排期批量上传入库，约 **1-2 周**。
- 更省事的替代方案仍是 Supabase（之前的 `docs/DEPLOY.md` 已写过完整迁移方案），但它不在 Cloudflare 上。选择 Cloudflare 等于选择“自己拥有全部代码 + 免费额度”，代价是自己维护认证与管理界面。

## 二、现在 PocketBase 替我们做了什么

| 角色 | PocketBase 提供 | 自建时需要替代 |
|---|---|---|
| 数据库 | SQLite（`pb/pb_data/data.db`） | Cloudflare D1（本身也是 SQLite 兼容） |
| API | `/api/collections/*/records` 公开读、提交写 | Worker 自己写的 REST 接口 |
| 审核逻辑 | `pb/pb_hooks/main.pb.js`（约 250 行转换钩子） | 把这段逻辑搬到 Worker 路由，基本可照抄 |
| 管理后台 | 自带 `/_/` 网页后台 | **必须自己做一个简单的后台页面**（这是最大的隐藏成本） |
| 认证 | PocketBase 管理员账号 | 单管理员可使用 Cloudflare Access 或自写简单登录 |
| 导入/备份 | 已有 `import_pocketbase.py`、`backup_pocketbase.ps1` | D1 导入脚本 + D1 导出备份（可复用大部分现有脚本思路） |
| 前端数据层 | `web/data_loader.js` 直接调 PB 接口 | 若保持接口路径相似，只改配置，不用重写前端 |

## 三、要重建的零件（按工作量从大到小）

1. **管理后台页面（约 0.5-1 天）**
   - 登录 → 待审核列表 → 通过/驳回 → 显示 review_note。
   - 现在团队只有你一个管理员，不需要复杂角色；一个页面即可。
2. **Worker API（约 0.5-1 天）**
   - 推荐 Hono（Cloudflare 上最常用的轻量框架）。
   - 接口最少只需 3 组：
     - `GET /api/health`
     - `GET /api/collections/*/records`（兼容现有 `data_loader.js`，前端改动最小）
     - `POST /api/submissions`（新增提交）
     - 管理员接口：`GET/POST` 审核动作
3. **审核自动入库逻辑（约 0.5 天）**
   - 把 `main.pb.js` 的“approved → 写入 actors/musicals/actor_roles/relations/moments”原样翻译成 Worker 里的 D1 事务，逻辑完全相同。
4. **D1 建表 + 数据迁移（约 0.5 天）**
   - 六张集合照搬：`actors / musicals / actor_roles / relations / moments / submissions`。
   - 编写从现有 SQLite（或 PocketBase data.db）导入 D1 的脚本；当前数据量很小（4532 演员、515 剧目、7816 卡司、268 关系），D1 免费额度绰绰有余。
5. **部署与域名（半天内）**
   - `wrangler` 部署 Worker + D1 migrations；静态网页继续用 Cloudflare Pages 或已有 Vercel 都行。
   - 注意：如果没有 Cloudflare 账号，先注册（免费）。
6. **前端小改（半天内）**
   - `data_loader.js` 的 base URL 改为 Worker 地址；提交接口若路径兼容则只改一个 URL。
   - “演出排期批量上传”的解析仍是前端逻辑，后端只需新增一个 `schedule_submission` 类型的接收与审核入库字段。

## 四、难度与时间

### 最小可用版（推荐先做这个）
- 范围：D1 + Worker API + 单管理员登录 + 提交/待审核/通过/驳回 + 前端接入 + 现有四类提交入库。
- 时间：约 **8-16 小时**，一个人（有 AI 辅助）拆成 2-3 个晚上也能完成。
  > 口径说明：这是从开工到验收的总耗时，不是 AI 连续运行时长；包含注册账号、人工确认、浏览器验收、回归测试和反复调整，纯 AI 编码阶段通常只占其中一部分。
- 难度：中等偏低。没有复杂算法，难的是环境搭建（首次 Wrangler/D1 配置）和把现有钩子翻译成 Worker 事务。

### 完整上线版
- 增加：正式数据全部上线、批量排期提交入库、审核日志、D1 备份恢复、Cloudflare Access、SEO/域名。
- 时间：约 **1-2 周**。
- 难度：中等。主要时间花在管理后台体验、数据迁移回归、以及上线后的维护脚本上。

## 五、需要小心的点

- **管理后台要自己写**：PocketBase 自带的后台是白送的，自建后这块归我们维护。请把它当成“必须做的功能”，不要漏算。
- **认证别偷懒**：反馈入口公开可提交没问题，但审核接口必须只有你能访问。最省事是 Cloudflare Access 包一层（免费 50 用户内）。
- **数据迁移先 dry-run**：先用现有导入脚本的思路导出 CSV/JSON 核对行数，再写 D1；D1 导入失败要可重跑（按 legacy_id 幂等）。
- **免费额度**：Cloudflare Workers/D1 的免费额度对当前数据量（几千行）非常充裕，但“以官方页面最新为准”。
- **不急着重写**：如果本周就要给简历/面试演示，先继续用现有静态版 + PocketBase 即可；重写只影响“云上审核闭环”，不影响图谱展示。

## 六、建议的下一步（如果决定做）

1. 在 `codex/backend-eval` 或新分支写一个 `cloudflare/` 目录：Hono Worker + D1 migrations + admin 页面。
2. 第一版只做“提交 → 待审核 → 通过/驳回 → 自动入库”，不上用户注册。
3. 保持与现有 `data_loader.js` 相同的 `/api/collections/*` 路径，前端零大面积改动。
4. 完成后用现有 `web/verify.js` 和 `web/verify_backend.js` 跑回归。

## 七、假设

- 只讨论 Cloudflare 路线；是否需要用户注册/多管理员按“先不做”估算。
- “重写”指新建部署在 Cloudflare 上的后端，不要求保留 PocketBase 目录。
- 批量排期上传的“表格识别/解析”在前端已经完成，后端只负责接收、审核和入库。
