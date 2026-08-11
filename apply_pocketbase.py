"""Apply approved PocketBase submissions back into music_graph.db (SQLite).

Purpose: keep the offline static snapshot (web/data.js via refresh_all.py)
consistent with admin-approved user contributions.

Flow:
  1. fetch submissions where status='approved' and applied=true
  2. skip ones already applied (tracked in SQLite table applied_submissions)
  3. write into artists/musicals/roles/actor_roles/relations/moments
  4. afterwards run:  python refresh_all.py

Usage:
  python apply_pocketbase.py --dry-run   # 只预览
  python apply_pocketbase.py             # 实际回写
"""
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

BASE = Path(__file__).resolve().parent
DB = Path(os.environ.get("MG_SQLITE_DB", str(BASE / "music_graph.db")))
PER_PAGE = 500
ACTOR_FIELDS = ["nickname", "birth_date", "major", "school", "hometown", "enrollment_year", "height", "note", "role"]


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


def api(method, url, body=None, token=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError("{} {} -> {}: {}".format(method, url, e.code, e.read().decode("utf-8", "replace")[:300]))


def fetch_all(url, token):
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


def next_id(cur, table):
    return (cur.execute("SELECT COALESCE(MAX(id),0)+1 FROM {}".format(table)).fetchone()[0])


def find_artist(cur, name):
    return cur.execute("SELECT id FROM artists WHERE name=? ORDER BY id LIMIT 1", (name,)).fetchone()


def find_musical(cur, name):
    return cur.execute("SELECT id FROM musicals WHERE name=? ORDER BY id LIMIT 1", (name,)).fetchone()


def ensure_artist(cur, name):
    row = find_artist(cur, name)
    if row:
        return row[0]
    aid = next_id(cur, "artists")
    cur.execute("INSERT INTO artists (id, name, is_actor) VALUES (?,?,1)", (aid, name))
    return aid


def ensure_musical(cur, name):
    row = find_musical(cur, name)
    if row:
        return row[0]
    mid = next_id(cur, "musicals")
    cur.execute("INSERT INTO musicals (id, name) VALUES (?,?)", (mid, name))
    return mid


def ensure_role(cur, musical_id, role_name):
    row = cur.execute("SELECT id FROM roles WHERE musical_id=? AND name=? LIMIT 1", (musical_id, role_name)).fetchone()
    if row:
        return row[0]
    rid = next_id(cur, "roles")
    cur.execute("INSERT INTO roles (id, musical_id, name) VALUES (?,?,?)", (rid, musical_id, role_name))
    return rid


def apply_actor(cur, sub):
    name = (sub.get("actor_a") or "").strip()
    if not name:
        return "跳过：缺少演员姓名"
    notes = []
    details = sub.get("details")
    if isinstance(details, str):
        try:
            details = json.loads(details)
        except Exception:
            details = None
    row = find_artist(cur, name)
    if row:
        aid = row[0]
        if details and isinstance(details, dict):
            if details.get("fix") and details["fix"].get("field") and details["fix"].get("correct"):
                f = details["fix"]["field"]
                if f in ACTOR_FIELDS:
                    cur.execute("UPDATE artists SET {}=? WHERE id=?".format(f), (str(details["fix"]["correct"]), aid))
                    notes.append("修正 " + f)
            for f in ACTOR_FIELDS:
                v = details.get(f)
                if v not in (None, ""):
                    cur.execute("UPDATE artists SET {}=? WHERE id=?".format(f), (str(v), aid))
        return "更新演员「{}」".format(name) + ("（" + "，".join(notes) + "）" if notes else "")
    aid = next_id(cur, "artists")
    fields = {"id": aid, "name": name, "is_actor": 1}
    if details and isinstance(details, dict):
        for f in ACTOR_FIELDS:
            v = details.get(f)
            if v not in (None, ""):
                fields[f] = str(v)
    cols = ", ".join(fields.keys())
    qs = ", ".join("?" * len(fields))
    cur.execute("INSERT INTO artists ({}) VALUES ({})".format(cols, qs), list(fields.values()))
    return "新建演员「{}」".format(name)


def apply_musical(cur, sub):
    name = (sub.get("musical_name") or "").strip()
    if not name:
        return "跳过：缺少剧目名称"
    details = sub.get("details")
    if isinstance(details, str):
        try:
            details = json.loads(details)
        except Exception:
            details = None
    details = details if isinstance(details, dict) else {}
    row = find_musical(cur, name)
    if row:
        mid = row[0]
        if details.get("fix") and details["fix"].get("field") in ("year", "description"):
            f = details["fix"]["field"]
            col = "premiere_date" if f == "year" else "info"
            cur.execute("UPDATE musicals SET {}=? WHERE id=?".format(col), (str(details["fix"]["correct"]), mid))
        if details.get("year"):
            cur.execute("UPDATE musicals SET premiere_date=? WHERE id=?", (str(details["year"]), mid))
        if details.get("description"):
            cur.execute("UPDATE musicals SET info=? WHERE id=?", (str(details["description"]), mid))
        result = "更新剧目「{}」".format(name)
    else:
        mid = next_id(cur, "musicals")
        fields = {"id": mid, "name": name}
        if details.get("year"):
            fields["premiere_date"] = str(details["year"])
        if details.get("description"):
            fields["info"] = str(details["description"])
        cols = ", ".join(fields.keys())
        qs = ", ".join("?" * len(fields))
        cur.execute("INSERT INTO musicals ({}) VALUES ({})".format(cols, qs), list(fields.values()))
        result = "新建剧目「{}」".format(name)
    for item in details.get("cast") or []:
        if not item or not item.get("actor"):
            continue
        aid = ensure_artist(cur, str(item["actor"]).strip())
        role_name = str(item.get("role") or "").strip()
        rid = ensure_role(cur, mid, role_name) if role_name else None
        dup = cur.execute("SELECT 1 FROM actor_roles WHERE artist_id=? AND musical_id=? AND role_id IS ?",
                          (aid, mid, rid)).fetchone()
        if not dup:
            cur.execute("INSERT INTO actor_roles (artist_id, musical_id, role_id) VALUES (?,?,?)", (aid, mid, rid))
    return result + "（含卡司 %d 行）" % len(details.get("cast") or [])


def apply_relation(cur, sub):
    a = (sub.get("actor_a") or "").strip()
    b = (sub.get("actor_b") or "").strip()
    code = sub.get("relation_type") or ""
    if not a or not b or not code:
        return "跳过：关系信息不完整"
    tid = cur.execute("SELECT id FROM relation_types WHERE code=?", (code,)).fetchone()
    if not tid:
        return "跳过：未知关系类型 " + code
    aid = ensure_artist(cur, a)
    bid = ensure_artist(cur, b)
    dup = cur.execute("SELECT 1 FROM relations WHERE type_id=? AND ((actor_a=? AND actor_b=?) OR (actor_a=? AND actor_b=?))",
                      (tid[0], aid, bid, bid, aid)).fetchone()
    if dup:
        return "跳过：关系已存在"
    rid = next_id(cur, "relations")
    cur.execute("""INSERT INTO relations (id, type_id, actor_a, actor_b, detail, source_url, source_type, status, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (rid, tid[0], aid, bid, sub.get("description") or "", sub.get("source_url") or "",
                 "user", "approved", datetime.now().isoformat(timespec="seconds")))
    return "写入关系「{} ↔ {}」".format(a, b)


def apply_moment(cur, sub):
    a = (sub.get("actor_a") or "").strip()
    title = (sub.get("title") or "").strip()
    url = (sub.get("url") or "").strip()
    if not a or not title or not url:
        return "跳过：精彩片段信息不完整"
    aid = ensure_artist(cur, a)
    dup = cur.execute("SELECT 1 FROM moments WHERE actor_id=? AND url=?", (aid, url)).fetchone()
    if dup:
        return "跳过：精彩片段已存在"
    mid = next_id(cur, "moments")
    cur.execute("""INSERT INTO moments (id, actor_id, title, url, source, created_time)
                   VALUES (?,?,?,?,?,?)""",
                (mid, aid, title, url, sub.get("platform") or "", datetime.now().isoformat(timespec="seconds")))
    return "写入精彩片段「{}」".format(title)


def main():
    dry = "--dry-run" in sys.argv
    env = load_env()
    base = os.environ.get("PB_URL", env.get("PB_URL", "http://127.0.0.1:8090")).rstrip("/")
    email = os.environ.get("PB_ADMIN_EMAIL", env.get("PB_ADMIN_EMAIL", ""))
    password = os.environ.get("PB_ADMIN_PASSWORD", env.get("PB_ADMIN_PASSWORD", ""))
    if not email or not password:
        print("请先设置 PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD（.env 或环境变量）")
        sys.exit(1)

    auth = api("POST", base + "/api/collections/_superusers/auth-with-password",
               {"identity": email, "password": password})
    token = auth["token"]
    print("管理员登录成功")

    import urllib.parse
    qs = urllib.parse.urlencode({"filter": "(status='approved' && applied=true)"})
    subs = fetch_all(base + "/api/collections/submissions/records?" + qs, token)
    print("已审核通过且已应用的提交：%d 条" % len(subs))

    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    cur.execute("""CREATE TABLE IF NOT EXISTS applied_submissions (
        submission_id TEXT PRIMARY KEY, applied_at TEXT)""")

    done = 0
    skipped = 0
    for s in subs:
        sid = s["id"]
        if cur.execute("SELECT 1 FROM applied_submissions WHERE submission_id=?", (sid,)).fetchone():
            skipped += 1
            continue
        t = s.get("submission_type")
        if t == "actor_update":
            msg = apply_actor(cur, s)
        elif t == "musical_update":
            msg = apply_musical(cur, s)
        elif t == "relation_update":
            msg = apply_relation(cur, s)
        elif t == "moment_submission":
            msg = apply_moment(cur, s)
        else:
            msg = "跳过：未知类型 " + str(t)
        if dry:
            print("  [预览] {} -> {}".format(sid, msg))
            continue
        cur.execute("INSERT OR IGNORE INTO applied_submissions (submission_id, applied_at) VALUES (?,?)",
                    (sid, datetime.now().isoformat(timespec="seconds")))
        done += 1
        print("  [已应用] {} -> {}".format(sid, msg))

    if dry:
        print("\n--dry-run：以上为预览，未写入 SQLite")
        return
    conn.commit()
    conn.close()
    print("\n回写完成：新增 %d 条，跳过 %d 条（此前已应用）" % (done, skipped))
    print("下一步建议：运行  python refresh_all.py  重新生成网页数据（web/data.js）")


if __name__ == "__main__":
    main()

