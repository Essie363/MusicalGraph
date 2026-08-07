import sqlite3
from pathlib import Path

BASE = Path(__file__).resolve().parent  # 脚本所在目录 = 项目根
DB = BASE / "music_graph.db"
conn = sqlite3.connect(DB)
cur = conn.cursor()

# Check 田野
cur.execute("SELECT id, name, (SELECT COUNT(*) FROM show_casts WHERE artist_id=artists.id) as cnt FROM artists WHERE name='田野'")
for r in cur.fetchall():
    print(r)

# Get CP type id
cp_id = cur.execute("SELECT id FROM relation_types WHERE code='cp'").fetchone()[0]

# Add missing: 田野×相征 (300, 264), 田野×许昌泰 (300, 1626)
for aid, bid, name in [(300, 264, "野相"), (300, 1626, "野泰")]:
    a, b = sorted((aid, bid))
    cur.execute("INSERT OR IGNORE INTO relations (type_id,actor_a,actor_b,detail,source_type,status,confidence) VALUES (?,?,?,?,?,?,?)",
                (cp_id, a, b, name, "user", "approved", 1.0))

# 星33动物园 without 李浩楠 (not in DB)
actors = [1626, 2169, 2006, 896, 2170, 824]  # 许昌泰,卢翰林,沈育奇,余镇鳌,叶宇锋,赵洪博
for i in range(len(actors)):
    for j in range(i + 1, len(actors)):
        a, b = sorted((actors[i], actors[j]))
        cur.execute("INSERT OR IGNORE INTO relations (type_id,actor_a,actor_b,detail,source_type,status,confidence) VALUES (?,?,?,?,?,?,?)",
                    (cp_id, a, b, "星33动物园", "user", "approved", 1.0))

conn.commit()
cur.execute("SELECT COUNT(*) FROM relations")
print("relations:", cur.fetchone()[0])

# Show CP co-work stats for top CPs
cur.execute("""
    SELECT r.detail, a.name, b.name,
           (SELECT n.co_show_count FROM co_work_edges n WHERE (n.actor_a=r.actor_a AND n.actor_b=r.actor_b) OR (n.actor_a=r.actor_b AND n.actor_b=r.actor_a)) as co_shows
    FROM relations r
    JOIN artists a ON r.actor_a=a.id
    JOIN artists b ON r.actor_b=b.id
    LIMIT 5
""")
print("sample CPs with co-shows:")
for r in cur.fetchall():
    print(" ", r[0], r[1], "x", r[2], "共演", r[3] or 0, "场")

conn.close()
