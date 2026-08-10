"""导入/更新精彩片段数据：data/moments.json -> music_graph.db 的 moments 表

用法: python import_moments.py
- 首次运行自动建表（moments 表不存在时创建）
- 用 JSON 内容整体替换 moments 表（JSON 是唯一维护入口，删除即从页面消失）
- actor 字段填演员姓名，脚本自动解析为 actor_id；找不到的演员会跳过并提示
"""
import json
import sqlite3
from pathlib import Path

BASE = Path(__file__).resolve().parent  # 脚本所在目录 = 项目根
DB = BASE / "music_graph.db"
SRC = BASE / "data" / "moments.json"

CREATE_SQL = """
CREATE TABLE IF NOT EXISTS moments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'bilibili',
  created_time TEXT DEFAULT (datetime('now', 'localtime'))
)
"""


def main():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    cur.execute(CREATE_SQL)

    data = json.loads(SRC.read_text(encoding="utf-8-sig"))
    items = data.get("moments", [])

    name2id = {}
    for r in cur.execute("SELECT id, name FROM artists"):
        name2id[r[1]] = r[0]

    cur.execute("DELETE FROM moments")
    ok = 0
    for it in items:
        aid = name2id.get((it.get("actor") or "").strip())
        if aid is None:
            print("跳过: 找不到演员「%s」" % it.get("actor"))
            continue
        cur.execute(
            "INSERT INTO moments (actor_id, title, url, source) VALUES (?,?,?,?)",
            (aid, it["title"], it["url"], it.get("source", "bilibili")),
        )
        ok += 1

    conn.commit()
    print("moments 已导入 %d 条 (共 %d 条记录)" % (ok, len(items)))
    conn.close()


if __name__ == "__main__":
    main()
