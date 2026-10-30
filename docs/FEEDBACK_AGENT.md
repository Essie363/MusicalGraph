# Feedback Agent

## 目标

定时整理 Supabase `submissions` 中的待审核反馈，理解口语化表达和错填字段，给管理员生成结构化审核建议。

第一版只写分析结果，不会把 `status` 改成 `approved`，也不会直接修改正式数据表。

## 工作流程

1. Cloudflare Cron 每天北京时间 09:00 触发一次 Worker。
2. Worker 领取最多 20 条 `pending + unprocessed` 提交。
3. 查询同名演员、剧目等数据库上下文。
4. 只在发给模型的副本中隐藏联系方式和 `client_id`，再调用 Workers AI 的 Qwen3；Supabase 原始提交完整保留，方便管理员联系用户。
5. 用固定 JSON Schema接收建议，再执行本地安全规则。
6. 将结果写入 `agent_analysis`，管理员继续在 Supabase Studio 做最终决定。

## 模型项目上下文

从 `feedback-agent-v4-relation-corrections` 起，每次调用免费模型时都会同时提供三层上下文：

1. 固定项目词典：MusicGraph 的用途、提交审核流程、关系与团体语义。
2. 当前提交类型契约：该类型真正需要哪些字段，哪些字段与它无关。
3. 动态数据库上下文：同名演员、同名剧目、已有关系和重复排期候选。

关键领域规则：

- `cp` 是粉丝组合和 CP 名，不是现实情侣；`couple`、`married`、`ex` 才是敏感现实关系。
- 同一对人物可以同时拥有最多三种关系，包括“亲人”。新提交使用 `relation_types` 数组，批准后每种关系分别写入 `relations`；旧数据和旧提交继续使用原有单项记录，无需迁移。
- CP 名属于关系 `detail`，不能写成某位演员的昵称。
- `co_work` 只由同一场具体演出的共同卡司产生，共同剧目列表不能直接增加共演场次。
- 精彩片段只需要演员、标题、视频 URL 和平台，不要求人物关系；视频 URL 本身可作为来源。
- 剧目提交不要求填写人物关系；只有剧名和官方主页时，应理解为建立空剧目或等待更多资料。
- 产品反馈不要求演员或剧目字段。
- `database_context` 仅用于核对，代码会删除任何试图把数据库旧资料当作用户新提交内容的建议。

领域上下文保持短小，不会把整份项目文档或隐私信息发送给模型。模型格式输出失败时会生成明确标注的保底人工审核单，不再让提交永久卡在 `failed`。

## 安全边界

- 原始提交不会被 Agent 改写。
- Agent 永远不会自动批准提交。
- 同名演员、找不到目标、敏感关系强制进入人工判断。
- 缺少来源时不能建议直接通过。
- `SUPABASE_SERVICE_KEY` 只保存为 Cloudflare Secret，不写进代码或前端。
- 意见反馈旧格式中的联系方式不会发送给模型。
- 邮箱、手机号、微信或 QQ 账号会在模型调用前替换为脱敏占位符。
- Worker 中断超过 30 分钟的任务会自动回到待处理队列。

## 审核通过后的关联更新

- 人物资料：写入 `artists`，不会改变共演次数。
- 好友、同学、CP、师生等明确关系：写入 `relations`，不会伪装成共演关系。
- 一条多选关系提交通过后，会按所选类型拆成多条 `relations` 记录；同一人物对已有的同类型关系不会重复插入。
- 关系勘误同时保存修改前与修改后的关系；批准后，新增关系会写入，保留关系不会重复，修改后取消的原关系会标记为不再生效。
- 剧目演员/角色：写入 `actor_roles`，表示参演过该剧目，但没有具体场次时不增加共演次数。
- 用户明确补充两人的历史共同作品时，可建立缺失的历史剧目并为两位演员补齐 `actor_roles`；角色未知则留空，不据此伪造排期或增加共演次数。
- 修正 CP 关系中的错误演员时，必须唯一匹配旧演员、另一方、CP 名和关系类型，并确认新组合不存在同名重复关系。
- 具体排期：按 `日期 + 时间 + 城市 + 剧目 + 剧院` 识别同一场演出，并补齐缺失卡司。
- 两名演员被补充到同一场具体演出后，`rebuild_co_work()` 会从全部线上排期重算共演场次、共同剧目数和首次/最后共演日期。
- 完全相同的排期不会重复建场；核心信息相同但剧院不同的排期会进入人工判断。

## 每日 Action 与人工数据

每日 Action 使用 `sync_supabase_daily.py`，只追加自动源中缺失的人物身份、剧目、角色、排期和卡司，不再用本地 SQLite 全量覆盖线上资料、关系、精彩片段或共演边。

发现人物 ID/名称冲突或疑似重复排期时，脚本会暂缓相关写入，并把记录放入 Supabase `sync_conflicts`。管理员筛选 `status = pending` 后选择修正、忽略或保留；处理后可改为 `resolved` 或 `ignored`。

## 首次配置

1. 在 Supabase SQL Editor 依次执行：

   - `docs/supabase_feedback_agent.sql`
   - `docs/supabase_daily_sync.sql`
   - `docs/supabase_approval_fix.sql`（重新安装支持合并旧排期的审核触发器）
   - `docs/supabase_relation_multiselect.sql`（增加关系多选字段与审核入库逻辑）
2. 在项目目录设置 Cloudflare Secrets：

   ```powershell
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_SERVICE_KEY
   ```

3. 本地验证：

   ```powershell
   node --test worker/feedback-agent.test.mjs
   npx wrangler deploy --dry-run
   ```

4. 本地检查确认后再执行 `npx wrangler deploy`。部署会同时启用每天北京时间 09:00 的 Cron Trigger。

## Studio 审核

在 `submissions` 表中筛选：

- `status = pending`
- `agent_status = ready`

重点查看 `agent_analysis`：

- `summary`：Agent 对原提交的概括
- `proposed_changes`：建议移动或修正的字段
- `recommendation`：建议通过、修改后通过、补充信息、人工判断或拒绝
- `risk_flags`：同名、敏感关系、缺少来源等风险
- `reasoning`：建议理由

Agent 失败时会保留 `agent_error`，不会影响原有人工审核流程。需要重试时，把 `agent_status` 改回 `unprocessed`。

## 在 Codex 对话中按需审核

不创建 Codex 定时任务。电脑关机期间，Cloudflare 的初审结果继续保存在 Supabase；用户下次打开本项目后，在当前对话说“我要审核反馈”或“检查待审核反馈”即可。

Codex 将运行：

```powershell
python feedback_review.py refresh
```

它会先处理尚未初审的提交，再读取 `pending + ready + unreviewed` 的结果并生成编号摘要。用户明确回复后，Codex 使用 `feedback_review.py decide` 写回批准、拒绝或暂缓决定。没有用户确认时不得执行决定命令。

### 一次性配置

1. 在 Supabase SQL Editor 执行 `docs/supabase_conversation_review.sql`。
2. 在项目 PowerShell 中运行：

   ```powershell
   .\setup_feedback_review.ps1
   npx wrangler deploy
   ```

脚本会生成随机的 `FEEDBACK_REVIEW_TOKEN`，同时保存为 Cloudflare Secret 和本机 `.env`。`.env` 已被 Git 忽略。这个令牌仅能调用受保护的审核接口，不包含 Supabase service key。

### 对话审批规则

- `批准 F123`：保持原提交内容批准。
- `F123 按 Agent 建议修改后批准`：Codex把用户确认的字段修正与批准放在同一次写入中。
- `拒绝 F123，原因……`：拒绝并记录原因。
- `暂缓 F123`：继续保留为 pending，但不再出现在默认待审列表；需要时可以读取 deferred。
- 写回时必须携带 Agent 处理版本；版本或状态已变化则返回冲突并要求重新读取。
