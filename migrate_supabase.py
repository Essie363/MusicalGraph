"""Migrate music_graph.db (SQLite) to Supabase (Postgres) via REST API.

Prereqs:
1. Create Supabase project + run the SQL in docs/DEPLOY.md (tables).
2. Set env vars (NOT committed to git):
     SUPABASE_URL=https://xxxx.supabase.co
     SUPABASE_SERVICE_KEY=eyJ...   (Settings -> API -> service_role, keep secret)

Usage:
  python migrate_supabase.py --dry-run   # 只统计将要导入的行数（离线自检）
  python migrate_supabase.py             # 实际导入

Design: stdlib only (urllib), batch inserts, preserves SQLite ids so
foreign keys (show_casts.show_id etc.) stay valid.  Tables import in
dependency order.  Idempotent-ish: uses upsert (Prefer: resolution=merge-duplicates)
on tables with primary keys; simple insert for show_casts/actor_roles.
"""
import json
import os
import sqlite3
import sys
import urllib.parse
import urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent  # 脚本所在目录 = 项目根
DB = BASE / "music_graph.db"
BATCH = 500  # 每批行数


def get_rows(cur, table, cols):
    return [dict(zip(cols, r)) for r in cur.execute(f"SELECT {','.join(cols)} FROM {table}")]


def to_batches(rows, n=BATCH):
    for i in range(0, len(rows), n):
        yield rows[i:i + n]


def post_json(url, payload, headers):
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status


def main():
    dry = "--dry-run" in sys.argv
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not dry and (not url or not key):
        print("请先设置环境变量 SUPABASE_URL 和 SUPABASE_SERVICE_KEY（或加 --dry-run 只做离线检查）")
        sys.exit(1)

    headers = {
        "apikey": key, "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
        "Prefer": "return=minimal, resolution=merge-duplicates",
    }

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # (表名, 列) —— 顺序即依赖顺序
    tables = [
        ("relation_types", ["code", "name", "is_builtin", "description"]),
        ("artists", ["id", "name", "nickname", "birth_date", "major", "school",
                     "hometown", "enrollment_year", "height", "note", "is_actor"]),
        ("musicals", ["id", "name", "is_original", "progress", "premiere_date", "info"]),
        ("roles", ["id", "musical_id", "name"]),
        ("actor_roles", ["artist_id", "musical_id", "role_id"]),
        ("groups", ["id", "name", "type"]),
        ("group_members", ["group_id", "artist_id"]),
        ("shows", ["id", "date", "time", "city", "musical", "theatre"]),
        ("show_casts", ["show_id", "artist_id", "role"]),
        ("co_work_edges", ["actor_a", "actor_b", "co_show_count", "co_musical_count",
                           "first_co_date", "last_co_date"]),
        ("relations", ["type_id", "actor_a", "actor_b", "detail", "source_type",
                       "source_url", "evidence", "status", "confidence",
                       "submitted_by", "created_at", "updated_at"]),
    ]

    total = 0
    for table, cols in tables:
        rows = get_rows(cur, table, cols)
        # SQLite boolean -> 0/1 保持；None 保留为 null
        for r in rows:
            for k in ("is_builtin", "is_actor", "is_original"):
                if k in r and r[k] is not None:
                    r[k] = bool(r[k])
        print(f"[{table}] {len(rows)} 行")
        if dry:
            total += len(rows)
            continue
        if not rows:
            continue
        for batch in to_batches(rows):
            # 主键表用 upsert（PK 冲突即更新）；无 PK 的表普通插入
            prefer = headers.copy()
            try:
                post_json(f"{url}/rest/v1/{table}", batch, prefer)
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", errors="replace")[:200]
                print(f"  !! {table} 批次失败 HTTP {e.code}: {body}")
                sys.exit(1)
            total += len(batch)
        print(f"  -> 已导入 {len(rows)} 行")

    conn.close()
    if dry:
        print(f"\n离线自检完成：共 {total} 行将导入（未连接 Supabase）")
        print("运行方式：设置 SUPABASE_URL / SUPABASE_SERVICE_KEY 后执行 python migrate_supabase.py")
    else:
        print(f"\n迁移完成：共导入 {total} 行")


if __name__ == "__main__":
    main()
