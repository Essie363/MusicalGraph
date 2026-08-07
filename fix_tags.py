import sqlite3, json, re
from pathlib import Path

BASE = Path(__file__).resolve().parent  # 脚本所在目录 = 项目根
DB = BASE / "music_graph.db"
conn = sqlite3.connect(DB)
TAGS = BASE / "data" / "group_cp_tags.json"
tags = json.load(open(TAGS, encoding="utf-8"))
clean = []
for t in tags:
    tag = t["group_tag"]
    if re.match(r"^1[5-9]\d(\.\d)?$", tag):
        cur = conn.cursor()
        cur.execute("UPDATE artists SET height=? WHERE id=?", (tag, t["artist_id"]))
        conn.commit()
        print("Fixed: {} height->{}".format(t["name"], tag))
    else:
        clean.append(t)
with open(TAGS, "w", encoding="utf-8") as f:
    json.dump(clean, f, ensure_ascii=False, indent=1)
print("group_cp_tags: {} entries".format(len(clean)))
conn.close()
