import sqlite3, re
from pathlib import Path

BASE = Path(__file__).resolve().parent  # 脚本所在目录 = 项目根
DB = BASE / "music_graph.db"
conn = sqlite3.connect(DB)
cur = conn.cursor()

# Add major column
try:
    cur.execute("ALTER TABLE artists ADD COLUMN major TEXT")
except sqlite3.OperationalError:
    pass

# Clean major: strip trailing / ; ,
cur.execute("UPDATE artists SET major=TRIM(major, ' /;,') WHERE major IS NOT NULL")
# Clean note: strip trailing
cur.execute("UPDATE artists SET note=NULLIF(TRIM(note, ' ;,/'), '') WHERE note IS NOT NULL")

# Handle mixed notes: separate profession info from job/org info
cur.execute("SELECT id,name,note,major FROM artists WHERE note LIKE '%系%' OR note LIKE '%专业%'")
for aid, name, note, major in cur.fetchall():
    if not note:
        continue
    parts = note.split("/")
    prof_parts = []
    other_parts = []
    for p in parts:
        p = p.strip()
        is_prof = any(k in p for k in ["系", "专业", "本科", "硕士", "方向", "演唱", "表演"])
        is_job = any(k in p for k in ["演员", "歌手", "国家", "团", "副团长", "主席", "主任",
                                        "教授", "公司", "剧院", "出品", "中心", "研究所", "舞蹈团",
                                        "制作人", "一级演员"])
        if is_prof and not is_job:
            prof_parts.append(p)
        else:
            other_parts.append(p)
    if prof_parts:
        new_major = "/".join(prof_parts)
        if major:
            new_major = major + "/" + new_major
        cur.execute("UPDATE artists SET major=? WHERE id=?", (new_major, aid))
    new_note = "/".join(other_parts) if other_parts else None
    if new_note != note:
        cur.execute("UPDATE artists SET note=? WHERE id=?", (new_note, aid))

# Extract alias from note that wasn't caught
cur.execute("SELECT id,name,note,nickname FROM artists WHERE note IS NOT NULL")
for aid, name, note, nick in cur.fetchall():
    for pat in ["原名", "曾用名", "本名"]:
        m = re.search(pat + r"\s*[:：]?\s*(\S+)", note)
        if m and m.group(1) not in (nick or ""):
            new_nick = (nick + " / " + m.group(1)) if nick else m.group(1)
            cur.execute("UPDATE artists SET nickname=? WHERE id=?", (new_nick, aid))
            rest = note.replace(m.group(0), "").strip("; ；,，/")
            cur.execute("UPDATE artists SET note=? WHERE id=?", (rest or None, aid))

conn.commit()

# verify
for aid in [1306, 384, 428, 24, 575, 299, 763, 1674]:
    cur.execute("SELECT name,nickname,major,school,note,enrollment_year FROM artists WHERE id=?", (aid,))
    print(cur.fetchone())

# relation_types - simplify to 6 core types
cur.execute("DELETE FROM relation_types")
core_types = [
    ("co_work", "共演", 1),
    ("classmate", "同学", 1),
    ("friend", "好友", 1),
    ("couple", "情侣", 1),
    ("teacher_student", "师生", 1),
    ("same_company", "同公司", 1),
]
cur.executemany("INSERT INTO relation_types (code,name,is_builtin) VALUES (?,?,?)", core_types)
conn.commit()
print("\nrelation_types simplified to", cur.execute("SELECT COUNT(*) FROM relation_types").fetchone()[0])

# count coverage
cur.execute("SELECT COUNT(DISTINCT artist_id) FROM show_casts")
t = cur.fetchone()[0]
cur.execute(
    "SELECT COUNT(*) FROM artists a WHERE EXISTS (SELECT 1 FROM show_casts sc WHERE sc.artist_id=a.id)"
    " AND (nickname IS NOT NULL OR birth_date IS NOT NULL OR school IS NOT NULL"
    " OR hometown IS NOT NULL OR enrollment_year IS NOT NULL OR height IS NOT NULL)"
)
print("coverage:", cur.fetchone()[0], "/", t)

conn.close()
print("\nDone. Now run: SELECT * FROM relation_types")
