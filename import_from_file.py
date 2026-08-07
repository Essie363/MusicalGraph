"""Parse E:\人员信息表.txt (fixed-width columns), import into DB, handle typos."""
import sqlite3, re, json, os
from pathlib import Path

BASE = Path(__file__).resolve().parent  # 脚本所在目录 = 项目根
DB = BASE / "music_graph.db"
SRC = r"E:\人员信息表.txt"  # 外部输入文件（不在项目内），按需修改

# Name corrections (typos in user data → DB name)
NAME_FIX = {
    "马海飞": "冒海飞",
    "钱馨楠": "钱蒙楠",
    "叶被玮": "叶筱玮",
    "遇弘羊": "遇泓羊",
    "黎玥衫": "黎玥杉",
    "申帅": "申帅",  # new, not a typo
}

MUSICIANS = {"(钢琴)", "(小提琴)", "(贝斯)", "(萨克斯)", "(吉他)", "(架子鼓)"}


def is_date(cell):
    cell = cell.strip()
    return bool(re.match(r'^\d{4}[-/]\d{1,2}[-/]\d{1,2}$', cell) or
                re.match(r'^\d{4}年\d{1,2}月\d{1,2}日$', cell) or
                re.match(r'^\d{1,2}月\d{1,2}日$', cell))


def is_height(cell):
    return bool(re.match(r'^1[5-9]\d(\.\d)?$', cell.strip()))


def parse_fixed_width(line):
    """Parse a fixed-width line by splitting on 2+ consecutive spaces."""
    line = line.rstrip()
    if not line:
        return None
    # Split on 2+ spaces to get columns
    parts = re.split(r'  +', line)
    parts = [p.strip() for p in parts if p.strip()]
    if not parts:
        return None

    name = parts[0]
    # Clean name: remove trailing numbers/spaces
    name = re.sub(r'\s+', '', name)

    # Skip header, separator, musicians
    if name in ("姓名", "--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------"):
        return None
    for m in MUSICIANS:
        if m in name:
            return None

    # Detect columns by content patterns
    # parts[0] always name
    # Then find: nickname (might have spaces/commas, NOT a date), birth_date, school, major, ...
    nickname = None
    birth_date = None
    school = None
    major = None
    hometown = None
    enrollment = None
    tags_rest = ""

    idx = 1
    # Check if parts[1] looks like nickname (not date, not school)
    if idx < len(parts) and not is_date(parts[idx]) and not ("大学" in parts[idx] or "学院" in parts[idx]):
        nickname = parts[idx]
        idx += 1
    # birth_date
    if idx < len(parts) and is_date(parts[idx]):
        birth_date = parts[idx]
        idx += 1
    # school
    if idx < len(parts) and ("大学" in parts[idx] or "学院" in parts[idx]):
        school = parts[idx]
        idx += 1
    # major
    if idx < len(parts) and ("专业" in parts[idx] or "表演" in parts[idx] or "音乐" in parts[idx] or "舞蹈" in parts[idx] or "教育" in parts[idx] or "演唱" in parts[idx] or "歌剧" in parts[idx] or "武术" in parts[idx] or "翻译" in parts[idx] or "贸易" in parts[idx] or "化学" in parts[idx] or "声乐" in parts[idx]):
        major = parts[idx]
        idx += 1
    # hometown
    if idx < len(parts) and ("省" in parts[idx] or "市" in parts[idx] or "县" in parts[idx] or "区" in parts[idx] or parts[idx] in ["上海", "北京", "天津", "重庆", "浙江", "江苏", "广东", "福建", "山东", "辽宁", "吉林", "黑龙江", "湖北", "湖南", "河南", "河北", "山西", "陕西", "四川", "安徽", "江西", "云南", "贵州", "广西", "海南", "甘肃", "青海", "宁夏", "内蒙古", "新疆", "西藏", "澳门", "香港", "台湾", "东北", "东北人"]):
        hometown = parts[idx]
        idx += 1
    # enrollment
    if idx < len(parts) and ("级" in parts[idx] or "年" in parts[idx] or parts[idx].startswith("20")):
        enrollment = parts[idx]
        idx += 1
    # rest: group tags, heights, CPs
    while idx < len(parts):
        tags_rest += " " + parts[idx]
        idx += 1

    # Parse tags_rest for height and group tags
    tags = []
    height = None
    for piece in re.split(r'[、，, ]+', tags_rest.strip()):
        piece = piece.strip()
        if not piece:
            continue
        if is_height(piece):
            height = piece
        elif len(piece) <= 20 and piece not in ("备注", "关联"):
            tags.append(piece)

    result = {
        "name": name,
        "nickname": normalize_nick(nickname),
        "birth_date": birth_date,
        "school": school,
        "major": major,
        "hometown": hometown,
        "enrollment": enrollment,
        "tags": tags,
        "height": height,
    }
    return result


def normalize_nick(nick):
    if not nick:
        return None
    # Take first meaningful part before parenthesis-heavy sections
    nick = re.sub(r'\s*\(.*?\)\s*', '', nick)  # remove parenthetical
    nick = nick.split(",")[0].strip()
    nick = nick.split("，")[0].strip()
    if not nick or len(nick) > 30:
        return None
    return nick


with open(SRC, encoding="utf-8") as f:
    lines = f.readlines()

records = [parse_fixed_width(l) for l in lines]
records = [r for r in records if r]

# Apply name corrections
for r in records:
    if r["name"] in NAME_FIX:
        r["_orig"] = r["name"]
        r["name"] = NAME_FIX[r["name"]]

# Dedupe by name, merge (fill nulls, append tags)
merged = {}
for r in records:
    k = r["name"]
    if k in merged:
        old = merged[k]
        for f in ["nickname", "birth_date", "school", "major", "hometown", "enrollment", "height"]:
            if r.get(f) and not old.get(f):
                old[f] = r[f]
        old["tags"] = list(set(old.get("tags", []) + r.get("tags", [])))
    else:
        merged[k] = dict(r)
        merged[k]["tags"] = list(r.get("tags", []))

records = list(merged.values())
print(f"parsed {len(records)} unique actors")

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
name2ids = {}
for aid, aname in cur.fetchall():
    name2ids.setdefault(aname, []).append(aid)

matched, unmatched, updated, new_inserts = 0, [], 0, 0
tags_all = json.load(open(os.path.join(BASE, "data", "group_cp_tags.json"), encoding="utf-8"))

for r in records:
    nm = r["name"]
    ids = name2ids.get(nm)
    if not ids:
        unmatched.append((nm, r.get("_orig", "")))
        # Insert new actor
        cur.execute("INSERT INTO artists (name,nickname,birth_date,school,hometown,enrollment_year,height,note,is_actor) VALUES (?,?,?,?,?,?,?,?,0)",
                    (nm, r.get("nickname"), r.get("birth_date"), r.get("school"),
                     r.get("hometown"), r.get("enrollment"), r.get("height"), r.get("major")))
        new_inserts += 1
        # Re-query for tags
        cur.execute("SELECT id FROM artists WHERE name=?", (nm,))
        new_id = cur.fetchone()[0]
        name2ids[nm] = [new_id]
        ids = [new_id]
    if len(ids) > 1:
        continue
    aid = ids[0]
    matched += 1
    for fkey, col in [("nickname", "nickname"), ("birth_date", "birth_date"),
                       ("school", "school"), ("hometown", "hometown"),
                       ("enrollment", "enrollment_year"), ("height", "height")]:
        val = r.get(fkey)
        if val:
            # Only update if currently null OR new value is different (for corrections)
            cur.execute(f"SELECT {col} FROM artists WHERE id=?", (aid,))
            existing = cur.fetchone()[0]
            if not existing or existing != val:
                cur.execute(f"UPDATE artists SET {col}=? WHERE id=?", (val, aid))
                updated += 1
    # major → store in note if note empty or doesn't have it
    if r.get("major"):
        cur.execute("SELECT note FROM artists WHERE id=?", (aid,))
        existing_note = cur.fetchone()[0]
        if not existing_note:
            cur.execute("UPDATE artists SET note=? WHERE id=?", (r["major"], aid))
    # tags
    for t in r.get("tags", []):
        if t and len(t) <= 15:
            tags_all.append({"name": nm, "artist_id": aid, "group_tag": t})

conn.commit()

# Dedupe tags
seen = set()
clean_tags = []
for t in tags_all:
    key = (t["artist_id"], t["group_tag"])
    if key not in seen:
        seen.add(key)
        clean_tags.append(t)
with open(os.path.join(BASE, "data", "group_cp_tags.json"), "w", encoding="utf-8") as f:
    json.dump(clean_tags, f, ensure_ascii=False, indent=1)

# Verify
print(f"matched: {matched}, updated: {updated}, new: {new_inserts}, unmatched: {len(unmatched)}")
print("unmatched:", [u[0] for u in unmatched])
print(f"tags: {len(clean_tags)}")

# Verify corrections
for nm in ["冒海飞", "钱蒙楠", "叶筱玮", "遇泓羊", "邵奕磊", "张泽"]:
    ids = name2ids.get(nm)
    if ids and len(ids) == 1:
        cur.execute("SELECT name,nickname,birth_date,school,hometown,enrollment_year,height FROM artists WHERE id=?", (ids[0],))
        print(cur.fetchone())

# Count coverage
cur.execute("SELECT COUNT(DISTINCT artist_id) FROM show_casts")
total = cur.fetchone()[0]
cur.execute("""SELECT COUNT(*) FROM artists a
    WHERE EXISTS (SELECT 1 FROM show_casts sc WHERE sc.artist_id=a.id)
      AND (nickname IS NOT NULL OR birth_date IS NOT NULL OR school IS NOT NULL
           OR hometown IS NOT NULL OR enrollment_year IS NOT NULL OR height IS NOT NULL)""")
has = cur.fetchone()[0]
print(f"\ncoverage: {has}/{total} = {has/total*100:.0f}%")
conn.close()
