"""Export current DB state to data/snapshot_*.csv (UTF-8-BOM, Excel-friendly).

Mirrors the existing snapshot formats:
- snapshot_artists.csv       : all artists with profile columns
- snapshot_relations.csv     : relations + co-work counts
- snapshot_groups.csv        : group members
- snapshot_co_work_top1000.csv : top 1000 co-work pairs by show count
- snapshot_summary.csv       : row counts
"""
import csv
import sqlite3
from pathlib import Path

BASE = Path(__file__).resolve().parent  # 脚本所在目录 = 项目根
DB = BASE / "music_graph.db"
DATA = BASE / "data"


def write_csv(name, header, rows):
    path = DATA / name
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    print(f"  {name}: {len(rows)} 行")


def main():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    print("导出快照...")
    # 1. artists
    write_csv("snapshot_artists.csv",
              ["id", "name", "nickname", "birth_date", "major", "school", "hometown",
               "enrollment_year", "height", "note", "is_actor"],
              cur.execute("""
                SELECT id, name, nickname, birth_date, major, school, hometown,
                       enrollment_year, height, note, is_actor
                FROM artists ORDER BY id
              """).fetchall())

    # 2. relations（含共演场次）
    rows = cur.execute("""
        SELECT r.id, rt.name, a.name, b.name, r.detail, r.source_type, r.status,
               COALESCE(e.co_show_count, 0)
        FROM relations r
        JOIN relation_types rt ON r.type_id = rt.id
        JOIN artists a ON r.actor_a = a.id
        JOIN artists b ON r.actor_b = b.id
        LEFT JOIN co_work_edges e
          ON (e.actor_a = r.actor_a AND e.actor_b = r.actor_b)
          OR (e.actor_a = r.actor_b AND e.actor_b = r.actor_a)
        ORDER BY r.id
    """).fetchall()
    write_csv("snapshot_relations.csv",
              ["relation_id", "type", "actor_a", "actor_b", "detail", "source", "status", "co_shows"],
              rows)

    # 3. groups
    rows = cur.execute("""
        SELECT g.name, g.type, a.name
        FROM group_members gm
        JOIN groups g ON gm.group_id = g.id
        JOIN artists a ON gm.artist_id = a.id
        ORDER BY g.id
    """).fetchall()
    write_csv("snapshot_groups.csv", ["group", "type", "member"], rows)

    # 4. co-work top 1000
    rows = cur.execute("""
        SELECT a.name, b.name, e.co_show_count, e.co_musical_count, e.first_co_date, e.last_co_date
        FROM co_work_edges e
        JOIN artists a ON e.actor_a = a.id
        JOIN artists b ON e.actor_b = b.id
        ORDER BY e.co_show_count DESC, e.co_musical_count DESC
        LIMIT 1000
    """).fetchall()
    write_csv("snapshot_co_work_top1000.csv",
              ["actor_a", "actor_b", "co_shows", "co_musicals", "first_date", "last_date"],
              rows)

    # 5. summary
    with_profile = cur.execute("""
        SELECT COUNT(*) FROM artists a
        WHERE EXISTS (SELECT 1 FROM show_casts sc WHERE sc.artist_id = a.id)
          AND (nickname IS NOT NULL OR birth_date IS NOT NULL OR school IS NOT NULL
               OR hometown IS NOT NULL OR enrollment_year IS NOT NULL OR height IS NOT NULL)
    """).fetchone()[0]
    summary = [
        ("artists (total)", cur.execute("SELECT COUNT(*) FROM artists").fetchone()[0]),
        ("with profile", with_profile),
        ("shows", cur.execute("SELECT COUNT(*) FROM shows").fetchone()[0]),
        ("co_work_edges", cur.execute("SELECT COUNT(*) FROM co_work_edges").fetchone()[0]),
        ("relations (total)", cur.execute("SELECT COUNT(*) FROM relations").fetchone()[0]),
        ("relations (classmate)", cur.execute("SELECT COUNT(*) FROM relations WHERE type_id=(SELECT id FROM relation_types WHERE code='classmate')").fetchone()[0]),
        ("relations (cp)", cur.execute("SELECT COUNT(*) FROM relations WHERE type_id=(SELECT id FROM relation_types WHERE code='cp')").fetchone()[0]),
        ("relations (couple)", cur.execute("SELECT COUNT(*) FROM relations WHERE type_id=(SELECT id FROM relation_types WHERE code='couple')").fetchone()[0]),
        ("groups", cur.execute("SELECT COUNT(*) FROM groups").fetchone()[0]),
        ("group_members", cur.execute("SELECT COUNT(*) FROM group_members").fetchone()[0]),
    ]
    write_csv("snapshot_summary.csv", ["table", "count"], summary)

    conn.close()
    print("快照导出完成")


if __name__ == "__main__":
    main()
