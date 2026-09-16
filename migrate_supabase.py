"""Migrate music_graph.db (SQLite) to Supabase (Postgres) via REST API.

Usage:
  python migrate_supabase.py --dry-run
    # 离线自检：统计各表行数、主键空值、外键孤儿、随机样本
  python migrate_supabase.py
    # 正式导入（需要 SUPABASE_URL / SUPABASE_SERVICE_KEY）
  python migrate_supabase.py --verify
    # 导入后核对：两侧行数、主键空值、外键孤儿、随机样本一致才算迁移完成
  python migrate_supabase.py --apply-identity-corrections
    # 只执行 data/supabase_identity_corrections.json 中已审核的精确修复
  python migrate_supabase.py --identity-recovery
    # 先清除审计名单中的错误关联，再回填恢复后的本地正确数据

Prereqs:
1. Create Supabase project + run the SQL in docs/DEPLOY.md (tables)
   and the extra statements in docs/DEPLOY_SUPABASE.md (submissions/RLS/triggers).
2. Set env vars (NOT committed to git):
     SUPABASE_URL=https://xxxx.supabase.co
     SUPABASE_SERVICE_KEY=eyJ...   (service role; local only, never in frontend/repo)

Design: stdlib only (urllib), batch inserts, preserves SQLite ids so
foreign keys stay valid. Tables import in dependency order.
Idempotent-ish: uses upsert (Prefer: resolution=merge-duplicates) on tables
with primary keys; simple insert for join tables.
"""
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
import time
from pathlib import Path

BASE = Path(__file__).resolve().parent
DB = BASE / "music_graph.db"
BATCH = 500
TOMBSTONES = BASE / "data" / "supabase_deletions.json"
IDENTITY_CORRECTIONS = BASE / "data" / "supabase_identity_corrections.json"
IDENTITY_AUDIT = BASE / "data" / "identity_change_audit.json"

TABLES = [
    ("relation_types", ["id", "code", "name", "is_builtin", "description"]),
    ("artists", ["id", "name", "nickname", "birth_date", "major", "school",
                 "hometown", "enrollment_year", "height", "note", "is_actor"]),
    ("musicals", ["id", "name", "is_original", "progress", "premiere_date", "info"]),
    ("roles", ["id", "musical_id", "name"]),
    ("actor_roles", ["artist_id", "musical_id", "role_id"]),
    ("groups", ["id", "name", "type"]),
    ("group_members", ["group_id", "artist_id"]),
    ("shows", ["id", "date", "time", "city", "musical", "theatre"]),
    ("show_casts", ["show_id", "artist_id", "role"]),
    ("moments", ["id", "actor_id", "title", "url", "source"]),
    ("co_work_edges", ["actor_a", "actor_b", "co_show_count", "co_musical_count",
                       "first_co_date", "last_co_date"]),
    ("relations", ["id", "type_id", "actor_a", "actor_b", "detail", "source_type",
                   "source_url", "evidence", "status", "confidence",
                   "submitted_by", "created_at", "updated_at"]),
]

# 核对元数据：主键、抽样字段、外键（child_col -> parent_table）
VERIFY = {
    "relation_types": {"pk": ["id"], "sample": ["id", "code", "name"], "fks": []},
    "artists": {"pk": ["id"], "sample": ["id", "name"], "fks": []},
    "musicals": {"pk": ["id"], "sample": ["id", "name"], "fks": []},
    "roles": {"pk": ["id"], "sample": ["id", "musical_id", "name"],
              "fks": [("musical_id", "musicals")]},
    "actor_roles": {"pk": [], "sample": ["artist_id", "musical_id", "role_id"],
                    "fks": [("artist_id", "artists"), ("musical_id", "musicals"),
                            ("role_id", "roles")]},
    "groups": {"pk": ["id"], "sample": ["id", "name", "type"],
               "fks": []},
    "group_members": {"pk": [], "sample": ["group_id", "artist_id"],
                      "fks": [("group_id", "groups"), ("artist_id", "artists")]},
    "shows": {"pk": ["id"], "sample": ["id", "date", "city", "musical"], "fks": []},
    "moments": {"pk": ["id"], "sample": ["id", "actor_id", "title", "url"],
                "fks": [("actor_id", "artists")]},
    "show_casts": {"pk": [], "sample": ["show_id", "artist_id", "role"],
                   "fks": [("show_id", "shows"), ("artist_id", "artists")]},
    "co_work_edges": {"pk": ["actor_a", "actor_b"],
                      "sample": ["actor_a", "actor_b", "co_show_count"],
                      "fks": [("actor_a", "artists"), ("actor_b", "artists")]},
    "relations": {"pk": ["id"], "sample": ["id", "type_id", "actor_a", "actor_b"],
                  "fks": [("type_id", "relation_types"), ("actor_a", "artists"),
                          ("actor_b", "artists")]},
}
SAMPLE_ROWS = 5


def load_env():
    env = {}
    p = BASE / ".env"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip()
    return env


def get_rows(cur, table, cols, where=""):
    sql = "SELECT {} FROM {}".format(",".join("`{}`".format(c) for c in cols), table)
    if where:
        sql += " WHERE " + where
    return [dict(zip(cols, r)) for r in cur.execute(sql)]


def get_count(cur, table, where=""):
    sql = "SELECT COUNT(*) FROM {}".format(table)
    if where:
        sql += " WHERE " + where
    return cur.execute(sql).fetchone()[0]


def get_logical_count(cur, table, cols):
    """Count unique join-table rows using the same columns as Supabase."""
    if table not in NON_PK_TABLES:
        return get_count(cur, table)
    select = ",".join("`{}`".format(c) for c in cols)
    sql = "SELECT COUNT(*) FROM (SELECT {} FROM {} GROUP BY {})".format(
        select, table, select)
    return cur.execute(sql).fetchone()[0]


def to_batches(rows, n=BATCH):
    for i in range(0, len(rows), n):
        yield rows[i:i + n]


def post_json(url, payload, headers):
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with open_retry(req) as resp:
        return resp.status


def apply_tombstones(url, key):
    """Apply only explicitly reviewed remote deletions.

    The normal migration upserts rows; it deliberately never prunes whole
    tables. This small, versioned list is the safe path for confirmed removals.
    """
    if not TOMBSTONES.exists():
        return
    items = json.loads(TOMBSTONES.read_text(encoding="utf-8")).get("deletions", [])
    for item in items:
        table = item.get("table")
        where = item.get("where")
        if not table or not isinstance(where, dict) or not where:
            raise RuntimeError("invalid Supabase tombstone entry")
        query = urllib.parse.urlencode({k: "eq." + str(v) for k, v in where.items()})
        req = urllib.request.Request(
            url + "/rest/v1/" + table + "?" + query,
            headers={**sb_headers(key), "Prefer": "return=representation"},
            method="DELETE",
        )
        with open_retry(req) as resp:
            deleted = json.loads(resp.read().decode("utf-8"))
        print("[tombstone] {} {} -> removed {} row(s)".format(
            table, where, len(deleted)))


def apply_identity_corrections(url, key):
    """Apply reviewed, exact remote repairs for reused upstream person IDs."""
    if not IDENTITY_CORRECTIONS.exists():
        return
    data = json.loads(IDENTITY_CORRECTIONS.read_text(encoding="utf-8"))
    allowed_tables = {name for name, _ in TABLES}
    for item in data.get("patches", []):
        table, where, values = item.get("table"), item.get("where"), item.get("values")
        if table not in allowed_tables or not isinstance(where, dict) or not where or not isinstance(values, dict):
            raise RuntimeError("invalid Supabase identity patch entry")
        query = urllib.parse.urlencode({k: "eq." + str(v) for k, v in where.items()})
        req = urllib.request.Request(
            url + "/rest/v1/" + table + "?" + query,
            data=json.dumps(values).encode("utf-8"),
            headers={**sb_headers(key), "Content-Type": "application/json",
                     "Prefer": "return=representation"},
            method="PATCH",
        )
        with open_retry(req) as resp:
            changed = json.loads(resp.read().decode("utf-8"))
        print("[identity patch] {} {} -> changed {} row(s)".format(
            table, where, len(changed)))
    for item in data.get("deletions", []):
        table, where = item.get("table"), item.get("where")
        if table not in allowed_tables or not isinstance(where, dict) or not where:
            raise RuntimeError("invalid Supabase identity deletion entry")
        query = urllib.parse.urlencode({k: "eq." + str(v) for k, v in where.items()})
        req = urllib.request.Request(
            url + "/rest/v1/" + table + "?" + query,
            headers={**sb_headers(key), "Prefer": "return=representation"},
            method="DELETE",
        )
        with open_retry(req) as resp:
            deleted = json.loads(resp.read().decode("utf-8"))
        print("[identity delete] {} {} -> removed {} row(s)".format(
            table, where, len(deleted)))


def identity_recovery_ids():
    """Return only source IDs explicitly identified by the Git-history audit."""
    if not IDENTITY_AUDIT.exists():
        raise RuntimeError("missing data/identity_change_audit.json")
    changes = json.loads(IDENTITY_AUDIT.read_text(encoding="utf-8")).get("changes", [])
    ids = sorted({int(item["id"]) for item in changes})
    if not ids:
        raise RuntimeError("identity audit contains no candidates")
    return ids


def apply_identity_recovery_cleanup(url, key):
    """Clear only stale remote links before re-importing corrected local links.

    The schedules themselves stay intact.  Their cast rows are merely made
    unassigned until the recovered baseline links are inserted by the normal
    migration below.
    """
    ids = identity_recovery_ids()
    query = urllib.parse.urlencode({"artist_id": "in.(" + ",".join(map(str, ids)) + ")"})
    for table, method, payload in (
        ("actor_roles", "DELETE", None),
        ("show_casts", "PATCH", {"artist_id": None}),
    ):
        headers = {**sb_headers(key), "Prefer": "return=representation"}
        data = None
        if payload is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url + "/rest/v1/" + table + "?" + query,
            data=data, headers=headers, method=method,
        )
        with open_retry(req) as resp:
            affected = json.loads(resp.read().decode("utf-8"))
        print("[identity recovery] {} -> affected {} row(s)".format(table, len(affected)))


# ---------- Supabase REST 小工具 ----------
def open_retry(req, tries=4, timeout=60):
    last = None
    for i in range(tries):
        try:
            return urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            if e.code < 500:
                raise
            last = e
        except Exception as e:
            last = e
        time.sleep(2 * (i + 1))
    raise last


def sb_headers(key):
    return {"apikey": key, "Authorization": "Bearer " + key,
            "Accept": "application/json"}


def sb_count(url, key, table, where=None):
    params = {"select": "*", "limit": "1"}
    if where:
        params.update(where)
    qs = urllib.parse.urlencode(params)
    req = urllib.request.Request(url + "/rest/v1/" + table + "?" + qs,
                                 headers=sb_headers(key), method="GET")
    req.add_header("Prefer", "count=exact")
    req.add_header("Range", "0-0")
    try:
        with open_retry(req) as resp:
            cr = resp.headers.get("Content-Range", "*/0")
        total = cr.rsplit("/", 1)[-1]
        return int(total) if total.isdigit() else None
    except urllib.error.HTTPError as e:
        raise RuntimeError("count {} -> HTTP {}: {}".format(
            table, e.code, e.read().decode("utf-8", "replace")[:300]))


def sb_fetch(url, key, table, select, where=None, limit=10):
    params = {"select": select, "limit": str(limit)}
    if where:
        params.update(where)
    qs = urllib.parse.urlencode(params)
    req = urllib.request.Request(url + "/rest/v1/" + table + "?" + qs,
                                 headers=sb_headers(key), method="GET")
    try:
        with open_retry(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError("fetch {} -> HTTP {}: {}".format(
            table, e.code, e.read().decode("utf-8", "replace")[:300]))


NON_PK_TABLES = {"actor_roles", "group_members", "show_casts"}

def canon(row, cols):
    return json.dumps([row.get(c) for c in cols], ensure_ascii=False, sort_keys=True)


def dedupe_rows(rows, cols):
    """Keep one copy of a logical row before inserting a join-table batch."""
    unique = []
    seen = set()
    for row in rows:
        key = canon(row, cols)
        if key not in seen:
            seen.add(key)
            unique.append(row)
    return unique

def fetch_existing(url, key, table, cols):
    select = ",".join(cols)
    out = set()
    offset = 0
    while True:
        qs = urllib.parse.urlencode({
            "select": select,
            "order": ",".join("{}.asc".format(c) for c in cols),
            "limit": "1000",
            "offset": str(offset),
        })
        req = urllib.request.Request(url + "/rest/v1/" + table + "?" + qs,
                                     headers=sb_headers(key), method="GET")
        with open_retry(req) as resp:
            rows = json.loads(resp.read().decode("utf-8"))
        for r in rows:
            out.add(canon(r, cols))
        if len(rows) < 1000:
            break
        offset += len(rows)
    return out

def post_json_retry(url, payload, headers, tries=3):
    last = None
    for i in range(tries):
        try:
            return post_json(url, payload, headers)
        except urllib.error.HTTPError as e:
            if e.code < 500:
                raise
            last = e
        except Exception as e:
            last = e
        time.sleep(2 * (i + 1))
    raise last

def sb_where_pk(pk_cols, row):
    vals = [row[c] for c in pk_cols]
    if len(vals) == 1:
        return {pk_cols[0]: "eq." + str(vals[0])}
    where = {}
    for c, v in zip(pk_cols, vals):
        where[c] = "eq." + str(v) if v is not None else "is.null"
    return where


def sb_where_exact(cols, row):
    where = {}
    for c in cols:
        v = row.get(c)
        where[c] = "is.null" if v is None else "eq." + str(v)
    return where


# ---------- 本地核对 ----------
def local_fk_orphans(cur, fks):
    issues = []
    for child, col, parent in fks:
        sql = ("SELECT COUNT(*) FROM {child} c WHERE c.{col} IS NOT NULL "
               "AND NOT EXISTS (SELECT 1 FROM {parent} p WHERE p.id = c.{col})")
        n = cur.execute(sql.format(child=child, col=col, parent=parent)).fetchone()[0]
        if n:
            issues.append("{}.{} -> {}: {} 孤儿".format(child, col, parent, n))
    return issues


def local_sample(cur, table, cols):
    sample = []
    try:
        sel = ",".join("\"{}\"".format(c) for c in cols)
        rows = cur.execute("SELECT {} FROM {} ORDER BY RANDOM() LIMIT {}".format(
            sel, table, SAMPLE_ROWS)).fetchall()
        sample = [dict(zip(cols, r)) for r in rows]
    except sqlite3.Error:
        sample = []
    return sample


def dry_run(cur):
    errors = []
    total = 0
    print("== SQLite 离线自检（--dry-run） ==")
    for table, cols in TABLES:
        n = get_count(cur, table)
        logical_n = get_logical_count(cur, table, cols)
        total += logical_n
        meta = VERIFY.get(table, {})
        pkinfo = ""
        if meta.get("pk"):
            parts = []
            for pk in meta["pk"]:
                nulls = get_count(cur, table, "\"{}\" IS NULL".format(pk))
                parts.append("{} 空值 {}".format(pk, nulls))
            pkinfo = " | PK: " + ", ".join(parts)
        sample = local_sample(cur, table, meta.get("sample", cols[:4]))
        duplicate_note = ""
        if logical_n != n:
            duplicate_note = " | 去重后 {} 行（过滤 {} 条重复）".format(logical_n, n - logical_n)
        print("[{}] {} 行{}{} | 抽样 {} 条".format(
            table, n, pkinfo, duplicate_note, len(sample)))
        if sample:
            for r in sample:
                print("   ", r)
    fk_issues = local_fk_orphans(cur, [(table, col, parent)
                                       for table, meta in VERIFY.items()
                                       for (col, parent) in meta.get("fks", [])])
    if fk_issues:
        errors.extend(fk_issues)
        for e in fk_issues:
            print("FK 问题:", e)
    else:
        print("FK 检查：无孤儿引用")
    print("共 {} 行将导入（连接表按唯一组合计）".format(total))
    if errors:
        print("自检未通过：{} 个问题".format(len(errors)))
        return False
    print("自检通过（未连接 Supabase）")
    return True


def verify_supabase(url, key, cur):
    errors = []
    print("== Supabase 核对（--verify） ==")
    for table, cols in TABLES:
        lcount = get_logical_count(cur, table, cols)
        scount = sb_count(url, key, table)
        if lcount != scount:
            errors.append("{} 行数不一致：SQLite {} vs Supabase {}".format(
                table, lcount, scount))
            print("[FAIL] {} 行数: local {} / sb {}".format(table, lcount, scount))
            continue
        print("[OK] {} 行数 {} 一致".format(table, lcount))
        meta = VERIFY.get(table, {})
        for pk in meta.get("pk", []):
            lnull = get_count(cur, table, "\"{}\" IS NULL".format(pk))
            snull = sb_count(url, key, table, {pk: "is.null"})
            if lnull != snull:
                errors.append("{}.{} 主键空值不一致：local {} / sb {}".format(
                    table, pk, lnull, snull))
                print("[FAIL] {}.{} 主键空值".format(table, pk))
        for col, parent in meta.get("fks", []):
            ln = get_count(cur, table, "\"{}\" IS NOT NULL".format(col))
            sn = sb_count(url, key, table, {col: "not.is.null"})
            req = urllib.request.Request(
                url + "/rest/v1/" + table + "?" + urllib.parse.urlencode(
                    {"select": "{}!inner!{}_{}_fkey(id)".format(parent, table, col), "limit": "1"}),
                headers=sb_headers(key), method="GET")
            req.add_header("Prefer", "count=exact")
            req.add_header("Range", "0-0")
            try:
                with open_retry(req) as resp:
                    cr = resp.headers.get("Content-Range", "*/0")
                sm = int(cr.rsplit("/", 1)[-1]) if cr.rsplit("/", 1)[-1].isdigit() else -1
            except urllib.error.HTTPError as e:
                errors.append("FK 查询失败 {}.{}：HTTP {}".format(table, col, e.code))
                continue
            if ln != sn or sn != sm:
                errors.append("{}.{} 外键问题：非空 local {} / sb {} / 命中 {}".format(
                    table, col, ln, sn, sm))
                print("[FAIL] {}.{} 外键: local {} / sb {} / matched {}".format(
                    table, col, ln, sn, sm))
    print("== 随机抽样比对 ==")
    for table, cols in TABLES:
        meta = VERIFY.get(table, {})
        sample_cols = meta.get("sample", cols[:4])
        rows = local_sample(cur, table, sample_cols)
        if not rows:
            continue
        ok = True
        if meta.get("pk"):
            for row in rows:
                where = sb_where_pk(meta["pk"], row)
                got = sb_fetch(url, key, table, ",".join(sample_cols),
                               where=where, limit=SAMPLE_ROWS + 1)
                want = tuple(row[c] for c in sample_cols)
                if not any(tuple(r[c] for c in sample_cols) == want for r in got):
                    ok = False
                    errors.append("{}.{} 抽样不一致：{}".format(
                        table, "-".join(meta["pk"]), row))
        else:
            for row in rows:
                where = sb_where_exact(sample_cols, row)
                got = sb_fetch(url, key, table, ",".join(sample_cols),
                               where=where, limit=2)
                if not got:
                    ok = False
                    errors.append("{}.{} 抽样未找到：{}".format(
                        table, "-".join(sample_cols), row))
        print("[{}] {} 抽样 {}".format("OK" if ok else "FAIL", table, len(rows)))
    if errors:
        print("核对失败，共 {} 个问题".format(len(errors)))
        for e in errors[:30]:
            print(" -", e)
        return False
    print("核对通过：行数/主键/外键/抽样全部一致")
    return True


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    dry = "--dry-run" in sys.argv
    verify = "--verify" in sys.argv
    identity_corrections_only = "--apply-identity-corrections" in sys.argv
    identity_recovery = "--identity-recovery" in sys.argv
    env = load_env()
    url = os.environ.get("SUPABASE_URL", env.get("SUPABASE_URL", "")).rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY", env.get("SUPABASE_SERVICE_KEY", ""))
    if not dry and not verify and not identity_corrections_only and (not url or not key):
        print("请先设置 SUPABASE_URL / SUPABASE_SERVICE_KEY（.env 或环境变量），或使用 --dry-run / --verify")
        sys.exit(1)

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    if dry:
        ok = dry_run(cur)
        conn.close()
        sys.exit(0 if ok else 1)

    if verify:
        if not url or not key:
            print("--verify 需要 SUPABASE_URL / SUPABASE_SERVICE_KEY")
            sys.exit(1)
        ok = verify_supabase(url, key, cur)
        conn.close()
        sys.exit(0 if ok else 1)

    if identity_corrections_only:
        if not url or not key:
            print("--apply-identity-corrections 需要 SUPABASE_URL / SUPABASE_SERVICE_KEY")
            sys.exit(1)
        apply_identity_corrections(url, key)
        conn.close()
        return

    headers = {
        "apikey": key, "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
        "Prefer": "return=minimal, resolution=merge-duplicates",
    }

    apply_tombstones(url, key)
    if identity_recovery:
        apply_identity_recovery_cleanup(url, key)

    total = 0
    for table, cols in TABLES:
        rows = get_rows(cur, table, cols)
        for r in rows:
            for k in ("is_builtin", "is_actor", "is_original"):
                if k in r and r[k] is not None:
                    r[k] = bool(r[k])
        print("[{}] {} 行".format(table, len(rows)))
        if not rows:
            continue
        if table in NON_PK_TABLES:
            raw_count = len(rows)
            rows = dedupe_rows(rows, cols)
            local_duplicates = raw_count - len(rows)
            existing = fetch_existing(url, key, table, cols)
            rows = [r for r in rows if canon(r, cols) not in existing]
            print("  在线已有 {} 行，本次待新增 {} 行{}".format(
                len(existing), len(rows),
                "（过滤本地重复 {} 条）".format(local_duplicates)
                if local_duplicates else ""))
            if not rows:
                continue
        for batch in to_batches(rows):
            prefer = headers.copy()
            try:
                post_json_retry(url + "/rest/v1/" + table, batch, prefer)
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", errors="replace")[:200]
                print("  !! {} 批次失败 HTTP {}: {}".format(table, e.code, body))
                sys.exit(1)
            except Exception as e:
                print("  !! {} 批次失败: {}".format(table, e))
                sys.exit(1)
            total += len(batch)
        print("  -> 已导入 {} 行".format(len(rows)))

    conn.close()
    apply_identity_corrections(url, key)
    print("迁移完成：共导入 {} 行".format(total))
    print("下一步：运行 python migrate_supabase.py --verify 核对行数/主键/外键/抽样")


if __name__ == "__main__":
    main()
