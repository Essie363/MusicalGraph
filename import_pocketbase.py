"""Import music_graph.db (SQLite) data into PocketBase collections.

Collections imported (idempotent, keyed by legacy_id):
  actors / musicals / actor_roles / relations / moments

Usage:
  python import_pocketbase.py --dry-run   # 只统计将要导入的行数
  python import_pocketbase.py             # 实际导入

Credentials come from .env or env vars:
  PB_URL=http://127.0.0.1:8090
  PB_ADMIN_EMAIL=...   PB_ADMIN_PASSWORD=...
"""
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent
DB = BASE / "music_graph.db"
PER_PAGE = 500


# ---------- 小工具 ----------
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


def api(method, url, body=None, token=None, expect_error=False):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        msg = e.read().decode("utf-8", "replace")
        if expect_error:
            return {"_http_error": e.code, "body": msg}
        raise RuntimeError("{} {} -> {}: {}".format(method, url, e.code, msg[:300]))


def fetch_all(url, token):
    """分页拉取全部记录。"""
    items = []
    page = 1
    while True:
        sep = "&" if "?" in url else "?"
        r = api("GET", "{}{}page={}&perPage={}".format(url, sep, page, PER_PAGE), token=token)
        items.extend(r.get("items", []))
        if page >= r.get("totalPages", 1):
            break
        page += 1
    return items


def upsert_by_legacy(url, token, legacy_map, row, fields):
    """按 legacy_id 判断存在则 PATCH，否则 POST。返回操作标记。"""
    lid = row["legacy_id"]
    if lid in legacy_map:
        api("PATCH", "{}/{}".format(url, legacy_map[lid]), {k: v for k, v in fields.items() if v is not None}, token=token)
        return "update"
    r = api("POST", url, fields, token=token)
    legacy_map[lid] = r["id"]
    return "create"


def main():
    dry = "--dry-run" in sys.argv
    env = load_env()
    base = os.environ.get("PB_URL", env.get("PB_URL", "http://127.0.0.1:8090")).rstrip("/")
    email = os.environ.get("PB_ADMIN_EMAIL", env.get("PB_ADMIN_EMAIL", ""))
    password = os.environ.get("PB_ADMIN_PASSWORD", env.get("PB_ADMIN_PASSWORD", ""))
    if not dry and (not email or not password):
        print("请先设置 PB_URL / PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD（.env 或环境变量），或加 --dry-run 只做离线统计")
        sys.exit(1)

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # --- 统计（dry-run 也执行）---
    n_actors = cur.execute("SELECT COUNT(*) FROM artists").fetchone()[0]
    n_musicals = cur.execute("SELECT COUNT(*) FROM musicals").fetchone()[0]
    n_roles = cur.execute("SELECT COUNT(*) FROM actor_roles").fetchone()[0]
    n_relations = cur.execute("SELECT COUNT(*) FROM relations WHERE status='approved'").fetchone()[0]
    n_moments = cur.execute("SELECT COUNT(*) FROM moments").fetchone()[0]
    print("SQLite 数据量: 演员 %d | 剧目 %d | 卡司 %d | 关系(approved) %d | 精彩片段 %d" % (
        n_actors, n_musicals, n_roles, n_relations, n_moments))
    if dry:
        print("--dry-run：仅统计，未连接 PocketBase")
        return

    # --- 管理员登录 ---
    auth = api("POST", base + "/api/collections/_superusers/auth-with-password",
               {"identity": email, "password": password})
    token = auth["token"]
    print("管理员登录成功")

    stats = {"actors": 0, "musicals": 0, "actor_roles": 0, "relations": 0, "moments": 0}

    # --- actors ---
    url_actors = base + "/api/collections/actors/records"
    existing = fetch_all(url_actors + "?fields=id,legacy_id", token)
    legacy_actors = {int(r["legacy_id"]): r["id"] for r in existing if r.get("legacy_id")}
    rows = cur.execute("""SELECT id, name, nickname, birth_date, major, school, hometown,
                          enrollment_year, height, note, role, is_actor FROM artists""").fetchall()
    for r in rows:
        fields = {"legacy_id": r["id"], "name": r["name"]}
        for k in ("nickname", "birth_date", "major", "school", "hometown", "enrollment_year", "height", "note", "role"):
            if r[k] not in (None, ""):
                fields[k] = str(r[k])
        if r["is_actor"] not in (None, ""):
            fields["is_actor"] = bool(r["is_actor"])
        op = upsert_by_legacy(url_actors, token, legacy_actors, {"legacy_id": r["id"]}, fields)
        stats["actors"] += 1
    print("actors: %d 条已同步" % stats["actors"])

    # --- musicals ---
    url_musicals = base + "/api/collections/musicals/records"
    existing = fetch_all(url_musicals + "?fields=id,legacy_id", token)
    legacy_musicals = {int(r["legacy_id"]): r["id"] for r in existing if r.get("legacy_id")}
    rows = cur.execute("SELECT id, name, premiere_date, info FROM musicals").fetchall()
    for r in rows:
        year = ""
        if r["premiere_date"]:
            year = str(r["premiere_date"])[:4]
        fields = {"legacy_id": r["id"], "name": r["name"]}
        if year:
            fields["year"] = year
        if r["info"] not in (None, ""):
            fields["description"] = str(r["info"])
        upsert_by_legacy(url_musicals, token, legacy_musicals, {"legacy_id": r["id"]}, fields)
        stats["musicals"] += 1
    print("musicals: %d 条已同步" % stats["musicals"])

    # --- actor_roles ---
    url_ar = base + "/api/collections/actor_roles/records"
    existing = fetch_all(url_ar + "?fields=id,actor,musical,role", token)
    existing_keys = {(r["actor"], r["musical"], r.get("role", "")) for r in existing}
    rows = cur.execute("""
        SELECT ar.artist_id, ar.musical_id, r.name AS role
        FROM actor_roles ar LEFT JOIN roles r ON r.id = ar.role_id
    """).fetchall()
    for r in rows:
        a = legacy_actors.get(r["artist_id"])
        m = legacy_musicals.get(r["musical_id"])
        if not a or not m:
            continue
        key = (a, m, r["role"] or "")
        if key in existing_keys:
            continue
        api("POST", url_ar, {"actor": a, "musical": m, "role": r["role"] or ""}, token=token)
        stats["actor_roles"] += 1
    print("actor_roles: 新增 %d 条（其余已存在）" % stats["actor_roles"])

    # --- relations（仅 approved）---
    url_rel = base + "/api/collections/relations/records"
    existing = fetch_all(url_rel + "?fields=id,legacy_id", token)
    legacy_rels = {int(r["legacy_id"]): r["id"] for r in existing if r.get("legacy_id")}
    type_map = {r["id"]: r["code"] for r in cur.execute("SELECT id, code FROM relation_types")}
    rows = cur.execute("""SELECT id, type_id, actor_a, actor_b, detail, source_url, status
                          FROM relations WHERE status='approved'""").fetchall()
    for r in rows:
        a = legacy_actors.get(r["actor_a"])
        b = legacy_actors.get(r["actor_b"])
        if not a or not b:
            continue
        fields = {
            "legacy_id": r["id"],
            "actor_a": a, "actor_b": b,
            "relation_type": type_map.get(r["type_id"], str(r["type_id"])),
            "description": r["detail"] or "",
            "source": r["source_url"] or "",
        }
        upsert_by_legacy(url_rel, token, legacy_rels, {"legacy_id": r["id"]}, fields)
        stats["relations"] += 1
    print("relations: %d 条已同步" % stats["relations"])

    # --- moments ---
    url_mom = base + "/api/collections/moments/records"
    existing = fetch_all(url_mom + "?fields=id,legacy_id", token)
    legacy_moms = {int(r["legacy_id"]): r["id"] for r in existing if r.get("legacy_id")}
    rows = cur.execute("SELECT id, actor_id, title, url, source FROM moments").fetchall()
    for r in rows:
        a = legacy_actors.get(r["actor_id"])
        if not a:
            continue
        fields = {
            "legacy_id": r["id"],
            "actor": a,
            "title": r["title"] or "",
            "url": r["url"] or "",
            "platform": r["source"] or "",
            "description": "",
        }
        upsert_by_legacy(url_mom, token, legacy_moms, {"legacy_id": r["id"]}, fields)
        stats["moments"] += 1
    print("moments: %d 条已同步" % stats["moments"])

    conn.close()
    print("\n导入完成：%s" % json.dumps(stats, ensure_ascii=False))


if __name__ == "__main__":
    main()
