# PocketBase 后端存档（2026-08-23）

## 状态

- 当前项目线上后端采用 **Supabase**，PocketBase 不再作为主后端。
- 本目录是 **PocketBase 完整存档**，保留用于以后转向国内云服务器/国内域名时的本地数据管理回退。
- 存档标记：Git tag `archive/pocketbase-2026-08-23`（打在归档前的提交 `f26c090` 上，不推送）。

## 目录内容

```text
archive/pocketbase/
├── README.md              ← 本文件（存档与恢复说明）
├── POCKETBASE.md          ← 原 docs/POCKETBASE.md 使用指南
├── 后端操作指南.md          ← 原 docs/后端操作指南.md（小白版）
├── setup_pocketbase.ps1   ← 安装/初始化脚本
├── start_all.bat          ← 一键启动（PocketBase 后端 + 本地网页）
├── backup_pocketbase.ps1  ← 数据库备份脚本
├── import_pocketbase.py   ← SQLite → PocketBase 全量导入（幂等）
├── apply_pocketbase.py    ← 已审核内容回写 SQLite（可选）
└── pb/
    ├── pb_hooks/          ← 审核自动入库钩子（main.pb.js）
    ├── pb_migrations/     ← 建表迁移（0001_init.js）
    ├── pb_data/           ← 本地数据库（不入 Git）
    ├── pocketbase.exe     ← 二进制（不入 Git）
    └── *.log              ← 运行日志（不入 Git）
```

## 如何恢复使用（未来转国内服务器时）

1. 确认本机已安装 Python 3。
2. 在项目根目录配置 `.env`（参考根目录 `.env.example`），填入管理员账号：
   - `PB_URL=http://127.0.0.1:8090`
   - `PB_ADMIN_EMAIL=...`
   - `PB_ADMIN_PASSWORD=...`
3. 打开 PowerShell，进入本存档目录：
   ```powershell
   cd "E:\AI VibeCoding Project\MusicGraph\archive\pocketbase"
   ```
4. 若 `pb\pocketbase.exe` 不存在，先运行初始化：
   ```powershell
   powershell -ExecutionPolicy Bypass -File setup_pocketbase.ps1
   ```
5. 一键启动后端与本地网页：
   ```powershell
   .\start_all.bat
   ```
   - 后端：http://127.0.0.1:8090
   - 管理后台：http://127.0.0.1:8090/_/
   - 网页：http://localhost:8080（指向项目根 `web/`）
6. 导入本地数据（脚本已修正为读取项目根 `music_graph.db`）：
   ```powershell
   cd "E:\AI VibeCoding Project\MusicGraph"
   python archive\pocketbase\import_pocketbase.py --dry-run
   python archive\pocketbase\import_pocketbase.py
   ```
7. 备份数据库（输出到项目根 `data/backups/`，保留最近 30 份）：
   ```powershell
   powershell -ExecutionPolicy Bypass -File archive\pocketbase\backup_pocketbase.ps1
   ```

## 与 Supabase 路线的关系

- 迁移到 Supabase 后，本地 SQLite（`music_graph.db`）仍保留作为离线快照与数据源。
- 如后续转回国内服务器：先恢复本存档的 PocketBase 做本地审核，再用 `apply_pocketbase.py` 回写 SQLite，最后按当时部署方式重新上线。
- 不要删除本目录或其中的 hook/迁移脚本，它们是“审核自动入库”逻辑的唯一本地完整实现之一。

## 安全提示

- 本存档不含任何 service role key / API key；管理员密码请只放在本地 `.env`，不要写入 Git。
- `pb_data`、`pocketbase.exe`、运行日志不入 Git（见根目录 `.gitignore`），若需要完整便携副本，请连这些文件一起打包。