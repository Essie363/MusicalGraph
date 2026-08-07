"""Import user-provided actor profile data (tab-separated).
   Columns: 姓名 昵称 生日 毕业院校 专业 籍贯 入学年份 团伙 身高
   Some rows skip nickname → detect and align columns.
"""
import re
import sqlite3
import os
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent  # 脚本所在目录 = 项目根
DB = BASE / "music_graph.db"

with open(os.path.join(BASE, "import_profiles.py"), encoding="utf-8") as f:
    script_text = f.read()

m = re.search(r'raw\s*=\s*r?(?P<q>""")(.*?)(?P=q)', script_text, re.DOTALL)
if not m:
    print("ERROR: could not find raw data")
    exit(1)
raw = m.group(2)


def is_date(cell):
    return bool(re.match(r'^\d{4}/\d{1,2}/\d{1,2}$', cell) or
                re.match(r'^\d{4}年\d{1,2}月\d{1,2}日$', cell) or
                re.match(r'^\d{1,2}月\d{1,2}日$', cell) or
                re.match(r'^\d{4}$', cell))


def is_height(cell):
    return bool(re.match(r'^1[5-9]\d(\.\d)?$', cell))


def parse_line(line):
    line = line.strip()
    if not line or line.startswith("姓名"):
        return None
    parts = line.split("\t")
    if not parts or not parts[0].strip():
        return None
    # check if nickname is missing → detect by offset
    offset = 0
    if len(parts) > 1 and is_date(parts[1]):
        offset = 1  # parts[1] is actually birth_date, not nickname
    data = list(parts)
    if offset:
        data.insert(1, "")
    # now data has fields at correct indices: 0=name 1=nick 2=bd 3=school 4=major 5=hometown 6=enroll 7=group 8=height
    def get(i):
        return data[i].strip() if i < len(data) and data[i].strip() else None

    rec = {
        "name": data[0].strip(),
        "nickname": get(1),
        "birth_date": get(2),
        "school": get(3),
        "major": get(4),
        "hometown": get(5),
        "enrollment": get(6),
        "group_cp": get(7),
        "height": get(8),
    }
    if rec["name"].endswith(("(贝斯)", "(萨克斯)", "(小提琴)", "(钢琴)")):
        return None
    return rec


records_raw = [parse_line(l) for l in raw.strip().split("\n")]
records_raw = [r for r in records_raw if r]
# dedupe by name, merge non-None fields
merged = {}
for r in records_raw:
    k = r["name"]
    if k in merged:
        for f, v in r.items():
            if v and not merged[k].get(f):
                merged[k][f] = v
    else:
        merged[k] = dict(r)
records = list(merged.values())

print(f"parsed {len(records)} unique actors")

# Connect DB
conn = sqlite3.connect(DB)
cur = conn.cursor()

for col, ctype in [
    ("nickname", "TEXT"), ("birth_date", "TEXT"), ("hometown", "TEXT"),
    ("enrollment_year", "TEXT"), ("school", "TEXT"), ("height", "TEXT"),
]:
    try:
        cur.execute(f"ALTER TABLE artists ADD COLUMN {col} {ctype}")
    except sqlite3.OperationalError:
        pass

cur.execute("SELECT id, name FROM artists")
name_to_ids = {}
for aid, aname in cur.fetchall():
    name_to_ids.setdefault(aname, []).append(aid)

matched, unmatched, multiple = [], [], []
total_updates = 0
for r in records:
    nm = r["name"]
    ids = name_to_ids.get(nm)
    if not ids:
        unmatched.append(nm)
        continue
    if len(ids) > 1:
        multiple.append((nm, ids))
        continue
    aid = ids[0]
    matched.append(nm)
    fmap = {
        "nickname": "nickname", "birth_date": "birth_date", "hometown": "hometown",
        "enrollment": "enrollment_year", "school": "school", "height": "height",
    }
    for fkey, col in fmap.items():
        val = r.get(fkey)
        if val:
            cur.execute(f"UPDATE artists SET {col}=? WHERE id=?", (val, aid))
            total_updates += 1

# group/CP extraction (from known position 7)
group_cp_rows = []
for r in records:
    gc = r.get("group_cp")
    if not gc:
        continue
    nm = r["name"]
    ids = name_to_ids.get(nm)
    if not ids or len(ids) > 1:
        continue
    for tag in re.split(r'[、，,\s]+', gc):
        tag = tag.strip()
        if not tag:
            continue
        # skip values that look like other fields (data misalignment)
        if is_date(tag) or is_height(tag) or "专业" in tag or "音乐" in tag or "学院" in tag or len(tag) > 8:
            continue
        if tag in ("(小提琴)", "(钢琴)", "(贝斯)", "(萨克斯)"):
            continue
        group_cp_rows.append({"name": nm, "artist_id": ids[0], "group_tag": tag})

conn.commit()

print(f"matched: {len(matched)}, unmatched: {len(unmatched)}, multiple: {len(multiple)}, updates: {total_updates}")
print("UNMATCHED:", unmatched)
print("MULTIPLE:", multiple)
print()

# Add relation types
for code, name, builtin, desc in [
    ("cp", "荧幕CP/搭档", 1, "表演搭档、CP关系"),
    ("dorm", "同寝", 1, "同一宿舍/室友"),
    ("cohort", "同届同学", 1, "同一学校、同一年级"),
    ("band", "乐队/组合", 1, "乐队或音乐组合成员"),
    ("group", "团体成员", 0, "同一团体/厂牌/剧团"),
]:
    cur.execute("INSERT OR IGNORE INTO relation_types (code,name,is_builtin,description) VALUES (?,?,?,?)",
                (code, name, builtin, desc))
conn.commit()

print("=== GROUP/CP TAGS (clean) ===")
seen_tags = set()
for gr in group_cp_rows:
    key = (gr["name"], gr["group_tag"])
    if key not in seen_tags:
        seen_tags.add(key)
        print(f"  {gr['name']} -> [{gr['group_tag']}]")

with open(os.path.join(BASE, "data", "group_cp_tags.json"), "w", encoding="utf-8") as f:
    json.dump(group_cp_rows, f, ensure_ascii=False, indent=1)

# Verify a few key actors to confirm parsing correctness
print()
print("=== VERIFY key actors ===")
for nm in ["刘令飞", "阿云嘎", "阿拉丁", "毛二", "胡超政", "余思冉"]:
    ids = name_to_ids.get(nm)
    if ids and len(ids) == 1:
        cur.execute("SELECT name,nickname,birth_date,school,hometown,enrollment_year,height FROM artists WHERE id=?", (ids[0],))
        r = cur.fetchone()
        print(f"  {nm}: nick={r[1]}, bd={r[2]}, school={r[3]}, hometown={r[4]}, enroll={r[5]}, height={r[6]}")

conn.close()
print("\nDone.")
