import sqlite3
from pathlib import Path
BASE = Path(__file__).resolve().parent  # 脚本所在目录 = 项目根
conn = sqlite3.connect(BASE / "music_graph.db")
cur = conn.cursor()
cur.execute("""
    SELECT a.id, a.name,
        (SELECT COUNT(DISTINCT musical_id) FROM actor_roles WHERE artist_id=a.id) as musicals,
        (SELECT COUNT(*) FROM show_casts WHERE artist_id=a.id) as shows
    FROM artists a
    WHERE a.nickname IS NULL AND a.birth_date IS NULL
      AND a.school IS NULL AND a.hometown IS NULL
      AND a.enrollment_year IS NULL AND a.height IS NULL
      AND (SELECT COUNT(DISTINCT musical_id) FROM actor_roles WHERE artist_id=a.id) >= 5
    ORDER BY 3 DESC, 4 DESC
    LIMIT 40
""")
print("参与剧目>=5部 但完全无档案（按剧目数排）:")
for r in cur.fetchall():
    print("  id={:<6} {:<14} {:>3}部剧  {:>5}场".format(r[0], r[1], r[2], r[3]))
conn.close()
