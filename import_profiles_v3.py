"""Final clean import: reset + re-import user data, with manual fix for known misalignments."""
import re, sqlite3, os, json
from pathlib import Path

BASE = Path(__file__).resolve().parent  # 脚本所在目录 = 项目根
DB = BASE / "music_graph.db"

with open(os.path.join(BASE, "import_profiles.py"), encoding="utf-8") as f:
    raw = re.search(r'raw\s*=\s*r?"""(.*?)"""', f.read(), re.DOTALL).group(1)


def is_date(cell):
    return bool(re.match(r'^\d{4}/\d{1,2}/\d{1,2}$', cell) or
                re.match(r'^\d{4}年\d{1,2}月\d{1,2}日$', cell) or
                re.match(r'^\d{1,2}月\d{1,2}日$', cell) or
                re.match(r'^\d{4}$', cell))


def parse_line(line):
    line = line.strip()
    if not line or "姓名" in line:
        return None
    parts = line.split("\t")
    if not parts or not parts[0].strip():
        return None
    offset = 0
    if len(parts) > 1 and is_date(parts[1]):
        offset = 1
    data = list(parts)
    if offset:
        data.insert(1, "")

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


records = [parse_line(l) for l in raw.strip().split("\n")]
records = [r for r in records if r]
merged = {}
for r in records:
    k = r["name"]
    if k in merged:
        for f, v in r.items():
            if v and not merged[k].get(f):
                merged[k][f] = v
    else:
        merged[k] = dict(r)

# Manual corrections for known data issues
# 1. Names with typos vs DB
NAME_FIX = {"党钰葳": "党韫葳"}  # if user data had typo
# 2. Known column misalignments: "group_cp" that looks like enrollment → flip
#    "height" that looks like group tag → move
for r_text in merged.values():
    gc = r_text.get("group_cp")
    if gc and ("级" in gc or "年" in gc or re.match(r'^(20|19)\d{2}', gc)):
        # This looks like enrollment, not group
        if not r_text.get("enrollment"):
            r_text["enrollment"] = gc
            r_text["group_cp"] = None
    ht = r_text.get("height")
    if ht and not re.match(r'^1[5-9]\d(\.\d)?$', ht):
        # This is NOT a height, likely a group tag in wrong column
        if not r_text.get("group_cp"):
            r_text["group_cp"] = ht
            r_text["height"] = None

records = list(merged.values())

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

# Apply name fixes
for r in records:
    if r["name"] in NAME_FIX:
        r["_orig_name"] = r["name"]
        r["name"] = NAME_FIX[r["name"]]

# Reset profile fields then re-import
profile_cols = ["nickname", "birth_date", "school", "hometown", "enrollment_year", "height"]
matched, unmatched, multiple = [], [], []
for r in records:
    nm = r["name"]
    ids = name_to_ids.get(nm)
    if not ids:
        unmatched.append((nm, r.get("_orig_name")))
        continue
    if len(ids) > 1:
        multiple.append((nm, ids))
        continue
    aid = ids[0]
    matched.append(nm)
    # Reset all profile fields first
    cur.execute("UPDATE artists SET nickname=NULL,birth_date=NULL,school=NULL,hometown=NULL,enrollment_year=NULL,height=NULL WHERE id=?", (aid,))
    cur.execute("UPDATE artists SET nickname=?,birth_date=?,school=?,hometown=?,enrollment_year=?,height=? WHERE id=?",
                (r.get("nickname"), r.get("birth_date"), r.get("school"),
                 r.get("hometown"), r.get("enrollment"), r.get("height"), aid))

conn.commit()

# Group/CP tags
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
        if not tag or len(tag) > 10 or is_date(tag):
            continue
        group_cp_rows.append({"name": nm, "artist_id": ids[0], "group_tag": tag})

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

with open(os.path.join(BASE, "data", "group_cp_tags.json"), "w", encoding="utf-8") as f:
    json.dump(group_cp_rows, f, ensure_ascii=False, indent=1)

print(f"matched={len(matched)} unmatched={len(unmatched)} multiple={len(multiple)}")
print("UNMATCHED:", unmatched)
print("MULTIPLE:", multiple)
print()
print("=== GROUP/CP TAGS ===")
for gr in group_cp_rows:
    print(f"  {gr['name']} -> [{gr['group_tag']}]")
print()
print("=== VERIFY ===")
for nm in ["刘令飞", "胡超政", "阿云嘎", "毛二", "阿拉丁", "姜崃"]:
    ids = name_to_ids.get(nm)
    if ids and len(ids) == 1:
        cur.execute("SELECT name,nickname,birth_date,school,hometown,enrollment_year,height FROM artists WHERE id=?", (ids[0],))
        r = cur.fetchone()
        print(f"  {nm}: nick={r[1]}, bd={r[2]}, school={r[3]}, hometown={r[4]}, enroll={r[5]}, height={r[6]}")
conn.close()
print("\nDone. Profiles updated, group tags saved.")
