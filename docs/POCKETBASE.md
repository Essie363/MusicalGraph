# POCKETBASE — 本地后端使用指南

> CAST LIGHT 的后端服务。PocketBase 是单个程序文件（自带 SQLite 数据库与管理后台），
> 负责：正式数据（演员/剧目/关系/精彩片段）存储、用户提交接收、管理员审核、审核通过后自动入库。
> 所有数据保存在本机 `pb/pb_data/`，不上传任何外部平台。

---

## 一、首次安装（一次性）

1. **下载并安装 PocketBase**
   ```powershell
   powershell -ExecutionPolicy Bypass -File setup_pocketbase.ps1
   ```
   - 自动下载 PocketBase v0.39.10 到 `pb/`（约 12MB，需要联网一次）
   - 按提示输入管理员邮箱和密码（用于登录后台，请记好）

2. **启动后端与网站**
   双击 `start_all.bat`
   - 后端：`http://127.0.0.1:8090`（PocketBase 服务）
   - 网站：`http://localhost:8080`（网页本地服务）
   - 首次启动会自动执行建表迁移（`pb/pb_migrations/`），无需手动建表

3. **导入现有数据（重要）**
   ```bash
   python import_pocketbase.py
   ```
   - 把 `music_graph.db` 里的 4532 名演员、515 部剧目、7816 条卡司、
     268 条关系、8 条精彩片段导入 PocketBase
   - 支持 `--dry-run` 先预览；重复运行不会产生重复数据（按 legacy_id 幂等）

4. **打开后台**
   浏览器访问 `http://127.0.0.1:8090/_/`，用第 1 步的邮箱/密码登录。

---

## 二、日常使用

### 启动
双击 `start_all.bat`（或分别运行 `pb\pocketbase.exe serve` 与
`python -m http.server 8080 --directory web`）。

### 网站数据源
- 网页会自动**优先读取 PocketBase 在线数据**（`web/data_loader.js`），
  因此审核通过的新内容刷新页面即可看到；
- 后端未运行时自动回退到静态快照 `web/data.js`（双击 index.html 也能用，
  但看不到审核通过的新内容）；
- 可用 `?mode=static` 强制离线快照，或用 `?pb=http://地址:端口` 指定后端地址。

### 用户提交 → 审核 → 入库 流程
1. 用户在网站 Contribute 页提交（演员/剧目/关系/精彩片段四类），
   写入 `submissions`（状态自动为 `pending`，来源链接必填）；
2. 管理员打开 `http://127.0.0.1:8090/_/` → 左侧 `submissions` 集合，
   筛选 `status = pending`，点开一条查看内容；
3. 审核：
   - **通过**：把 `status` 改为 `approved` 并保存 →
     服务端钩子（`pb/pb_hooks/main.pb.js`）自动写入对应正式集合
     （缺失的演员会自动创建占位档案，同名多义会在 `review_note` 提示）；
   - **拒绝**：把 `status` 改为 `rejected` 并保存（不写任何正式数据）。
4. 网站刷新后即可看到审核通过的内容（在线模式）。

> 钩子只做「字段转换 + 写入」，不做内容真伪判断——是否收录由管理员人工决定。

### 让离线快照也包含审核通过的内容（可选）
```bash
python apply_pocketbase.py          # 把已审核通过的提交回写 music_graph.db
python refresh_all.py               # 重新生成 web/data.js 静态快照
```
> `apply_pocketbase.py` 只写本地 SQLite，安全可逆；支持 `--dry-run` 预览。

---

## 三、四类提交的字段约定（submissions 结构化字段）

| 提交类型 | 必填字段 | 可选字段（details，JSON 字符串） |
|---|---|---|
| actor_update（演员） | actor_a、source_url | nickname / birth_date / major / school / hometown / enrollment_year / height / note / role；勘误 fix:{field,correct} |
| musical_update（剧目） | musical_name、source_url | year、description、cast:[{actor,role}]；勘误 fix:{field,correct}（field 限 year/description） |
| relation_update（关系） | actor_a、actor_b、relation_type、source_url | description（说明/勘误备注） |
| moment_submission（精彩片段） | actor_a、title、url、platform、source_url | description |

- relation_type 仅限：`co_work`(合作演出) / `classmate`(同学) / `teacher_student`(师生) / `same_company`(同公司)
- platform 仅限：`bilibili` / `netease` / `youtube`
- 精彩片段只保存 标题/链接/平台/简短描述，不保存视频、封面、播放量、点赞
- details 为 JSON **字符串**（JSVM 中 json 字段读取为字节数组，text 更稳定）

---

## 四、数据备份与恢复

### 备份（建议每周，或每次刷新数据前）
```powershell
powershell -ExecutionPolicy Bypass -File backup_pocketbase.ps1
```
- 把 `pb/pb_data/data.db` 复制到 `data/backups/pb_YYYYMMDD_HHMMSS.db`，只保留最近 30 份
- 也可以挂 Windows 计划任务定期执行

### 恢复
1. 停止 PocketBase（关闭 start_all.bat 里的后端窗口，或结束 pocketbase 进程）；
2. 用备份文件替换 `pb/pb_data/data.db`（可先改名保留当前文件）；
3. 重新启动 `start_all.bat`。

> 本项目核心资产是数据，请养成备份习惯。

---

## 五、数据库集合一览

| 集合 | 内容 | 访问规则 |
|---|---|---|
| actors | 演员档案（name、nickname、school 等） | 公开读，仅管理员写 |
| musicals | 剧目（name、year、description） | 公开读，仅管理员写 |
| actor_roles | 演员-剧目-角色 | 公开读，仅管理员写 |
| relations | 演员关系（relation_type、description、source） | 公开读，仅管理员写 |
| moments | 精彩片段（title、url、platform、description） | 公开读，仅管理员写 |
| submissions | 用户提交（结构化字段 + status） | 公开创建，仅管理员可读/改 |

- `legacy_id`：来自 music_graph.db 的原始整数 id，用于幂等导入
- 所有集合由 `pb/pb_migrations/0001_init.js` 自动创建，无需手动建表

---

## 六、常见问题

- **网页显示「数据源：PocketBase 在线」提示**：说明已连接后端，正常。
- **双击 index.html 打开但看不到新内容**：后端没启动，在用离线快照；启动后端后刷新即可。
- **Contribute 提交提示「后端未连接，已保存为本地草稿」**：后端没启动，
  提交已存到浏览器本地（Contribute 页可导出 JSON）；启动后端后重新提交即可。
- **审核通过后网页没变化**：确认网站是「在线」模式（有顶部提示），并刷新页面。
- **忘记管理员密码**：重新运行
  `pb\pocketbase.exe superuser upsert 你的邮箱 新密码`（在项目根目录执行）。
- **端口被占用**：改端口可运行 `pb\pocketbase.exe serve --http 127.0.0.1:8091`，
  并在网页加 `?pb=http://127.0.0.1:8091` 访问。

---

## 七、技术说明（给 AI/开发者）

- 数据流：`sync.py(SQLite) → import_pocketbase.py → PocketBase → web/data_loader.js(API) → 前端`
- 审核钩子：`pb/pb_hooks/main.pb.js`
  - `onRecordCreateRequest`：强制 submissions 为 pending（防伪造）
  - `onRecordUpdateRequest`：status 变 approved 且 applied=false 时做转换写入
  - 注意：请求级钩子必须调用 `event.next()`，否则请求会被截断（不写库、返回 200 空）
  - 注意：v0.39 JSVM 中钩子回调看不到文件顶层声明的函数，辅助函数需定义在回调内部
- 环境变量（`.env`，不入库）：`PB_URL` / `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD`
- `pocketbase.exe`、`pb/pb_data/`、`data/backups/` 均不入 Git
- 本阶段不部署上线；全部本地运行
