"""Fetch Baidu Baike profiles for active actors missing profiles.

Reads data/actor_priority.json (activity ranking), skips actors that already
have any profile field, and fetches lemma cards from Baidu Baike open API.
Output: data/profiles/batch_NN.json (same schema as existing batches), which
merge_baike.py then merges into the DB.

Uses only Python standard library (urllib) - no third-party deps needed.

Usage: python fetch_baike.py [limit]
"""
import json
import os
import re
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent  # 脚本所在目录 = 项目根
DB = BASE / "music_graph.db"
PRIORITY = BASE / "data" / "actor_priority.json"
PROFILES_DIR = BASE / "data" / "profiles"

API = "https://baike.baidu.com/api/openapi/BaikeLemmaCardApi"
HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"),
    "Accept": "application/json",
}

PROFILE_COLS = ["nickname", "birth_date", "major", "school", "hometown",
                "enrollment_year", "height", "note"]


def has_profile(cur, aid):
    row = cur.execute(
        "SELECT " + ",".join(PROFILE_COLS) + " FROM artists WHERE id=?", (aid,)
    ).fetchone()
    return any(v for v in row)


def extract_birth_date(item):
    for k, v in item.items():
        if "出生" in k or "生日" in k:
            return v
    return None


def extract_school(item):
    for k, v in item.items():
        if "毕业院校" in k or "学校" in k or "毕业学校" in k:
            return v
    return None


def http_get(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read()


def fetch(name):
    """Return dict with match/birth_date/school/school_detail/summary or None on failure."""
    params = urllib.parse.urlencode({
        "scope": "103", "format": "json", "appid": "379020", "bk_key": name,
    })
    try:
        body = http_get(API + "?" + params)
        data = json.loads(body.decode("utf-8"))
    except Exception:
        return None
    card = data.get("card") or {}
    if not card:
        return None
    info = card.get("basicInfo") or []
    item = {}
    if isinstance(info, list):
        for entry in info:
            if isinstance(entry, dict):
                k = entry.get("name") or entry.get("key") or ""
                v = entry.get("value") or entry.get("val") or ""
                item[str(k)] = str(v)
    elif isinstance(info, dict):
        for k, v in info.items():
            item[str(k)] = str(v) if v is not None else ""
    lemma = card.get("lemmaTitle") or card.get("title") or ""
    desc = card.get("lemmaDesc") or card.get("desc") or ""
    norm = lambda s: re.sub(r"[（(].*?[)）]", "", s).strip()
    match = (norm(lemma) == norm(name)) if lemma else None
    return {
        "match": match,
        "birth_date": extract_birth_date(item),
        "school": extract_school(item),
        "school_detail": None,
        "summary": (lemma + "。" + desc) if (lemma or desc) else None,
    }


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    priority = json.load(open(PRIORITY, encoding="utf-8"))
    targets = []
    for a in priority:
        aid, nm = a["id"], a["name"]
        if not has_profile(cur, aid):
            targets.append((aid, nm))
        if len(targets) >= limit:
            break
    print(f"目标 {len(targets)} 人（活跃但无档案，按活跃度）：")
    for aid, nm in targets:
        print(f"  id={aid} {nm}")
    if not targets:
        print("没有目标，退出")
        return

    PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    existing = [int(f.split("_")[1].split(".")[0]) for f in os.listdir(PROFILES_DIR)
                if f.startswith("batch_") and f.endswith(".json")]
    next_no = (max(existing) + 1) if existing else 0

    rows = []
    ok = fail = 0
    for aid, nm in targets:
        res = fetch(nm)
        if res is None:
            res = {"match": None, "birth_date": None, "school": None,
                   "school_detail": None, "summary": "FETCH_FAILED"}
            fail += 1
        else:
            ok += 1
        rows.append({"id": aid, "name": nm, **res})
        print(f"  {nm}: match={res['match']} 生日={res['birth_date']} 学校={res['school']}")
        time.sleep(0.6)  # 礼貌限速，降低反爬触发

    path = PROFILES_DIR / f"batch_{next_no}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=1)
    conn.close()
    print(f" 保存 {path}，成功 {ok}，失败 {fail}")
    print("下一步：python merge_baike.py 合并入库")


if __name__ == "__main__":
    main()
