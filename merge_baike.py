"""Merge Baidu Baike profiles (JSON) + user Excel data → DB, export uncovered actors."""
import sqlite3, json, glob, os, csv
from pathlib import Path

BASE = Path(__file__).resolve().parent  # 脚本所在目录 = 项目根
DB = BASE / "music_graph.db"
PROFILES_DIR = BASE / "data" / "profiles"

# 1. Load all baike profiles
baike = []
for f in glob.glob(str(PROFILES_DIR / "*.json")):
    data = json.load(open(f, encoding="utf-8"))
    items = data.values() if isinstance(data, dict) and not isinstance(data, list) else data
    if isinstance(items, dict):
        items = items.values()
    for item in items:
        if isinstance(item, dict) and item.get("match") is True:
            baike.append(item)

print(f"baike profiles with match=true: {len(baike)}")

conn = sqlite3.connect(DB)
cur = conn.cursor()

# Build name→id mapping
cur.execute("SELECT id, name FROM artists")
name2ids = {}
for aid, aname in cur.fetchall():
    name2ids.setdefault(aname, []).append(aid)

# 2. Merge baike data into artists (only fill null fields, don't overwrite user data)
merged = 0
for b in baike:
    nm = b["name"]
    ids = name2ids.get(nm)
    if not ids or len(ids) > 1:
        continue
    aid = ids[0]
    merged += 1
    # Only update if the field is currently NULL in DB (user Excel data takes priority)
    for col, b_key in [("birth_date", "birth_date"), ("school", "school")]:
        cur.execute(f"SELECT {col} FROM artists WHERE id=?", (aid,))
        existing = cur.fetchone()[0]
        b_val = b.get(b_key)
        if not existing and b_val:
            cur.execute(f"UPDATE artists SET {col}=? WHERE id=?", (b_val, aid))
    # school_detail: store in note if note is empty
    sd = b.get("school_detail")
    if sd:
        cur.execute("SELECT note FROM artists WHERE id=?", (aid,))
        existing_note = cur.fetchone()[0]
        if not existing_note:
            cur.execute("UPDATE artists SET note=? WHERE id=?", (sd, aid))

conn.commit()

# 3. Query: active actors with NO profile info at all
cur.execute("""
    SELECT a.id, a.name, COUNT(sc.show_id) as shows, COUNT(DISTINCT ar.musical_id) as musicals
    FROM artists a
    JOIN show_casts sc ON a.id = sc.artist_id
    LEFT JOIN actor_roles ar ON a.id = ar.artist_id
    WHERE a.nickname IS NULL AND a.birth_date IS NULL
      AND a.school IS NULL AND a.hometown IS NULL
      AND a.enrollment_year IS NULL AND a.height IS NULL
    GROUP BY a.id
    HAVING shows >= 30
    ORDER BY shows DESC
""")
uncovered = cur.fetchall()

print(f"merged baike: {merged}")
print(f"uncovered actors (>=30 shows, no profile): {len(uncovered)}")

# 4. Export uncovered list
OUT = BASE / "data" / "uncovered_actors.csv"
with open(OUT, "w", newline="", encoding="utf-8-sig") as f:
    w = csv.writer(f)
    w.writerow(["artist_id", "name", "shows", "musicals"])
    for r in uncovered:
        w.writerow(r)
print(f"exported to {OUT}")

# Count total with some profile data
cur.execute("""
    SELECT COUNT(*) FROM artists a
    WHERE EXISTS (SELECT 1 FROM show_casts sc WHERE sc.artist_id=a.id)
      AND (nickname IS NOT NULL OR birth_date IS NOT NULL OR school IS NOT NULL
           OR hometown IS NOT NULL OR enrollment_year IS NOT NULL OR height IS NOT NULL)
""")
has = cur.fetchone()[0]
cur.execute("SELECT COUNT(DISTINCT artist_id) FROM show_casts")
total_actor = cur.fetchone()[0]
print(f"actors with shows: {total_actor}, with profile: {has}, coverage: {has/total_actor*100:.0f}%")

conn.close()
