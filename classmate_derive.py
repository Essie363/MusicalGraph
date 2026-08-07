"""Derive classmate relations: same school + same enrollment year.

Rule: two actors are classmates if they share (school, enrollment year).
enrollment_year formats handled:
  - "2015级" / "2015级本科" / "2015级 (硕士)"  -> 2015
  - "2013级/2025级博士" -> first year (2013)
  - "17级" -> 2017
Unparseable values are skipped (printed at end).

Output: inserts into relations with type_id=classmate, source_type='derived',
status='approved'. Idempotent: skips pairs already present for classmate type.
"""
import sqlite3
import re
from collections import defaultdict
from pathlib import Path

BASE = Path(__file__).resolve().parent  # 脚本所在目录 = 项目根
DB = BASE / "music_graph.db"


def parse_year(s):
    """Extract enrollment year from free-text enrollment_year field."""
    if not s:
        return None
    s = s.strip()
    m = re.fullmatch(r"(\d{4})级?.*", s)
    if m:
        return int(m.group(1))
    m = re.fullmatch(r".*?(\d{4})级.*", s)  # "2013级/2025级博士" -> first
    if m:
        return int(m.group(1))
    m = re.fullmatch(r"(\d{2})级?$", s)     # "17级" -> 2017
    if m:
        y = int(m.group(1))
        return 2000 + y if 40 <= y <= 99 else None
    m = re.fullmatch(r".*?(\d{2})级.*", s)  # "中戏17"
    if m:
        y = int(m.group(1))
        return 2000 + y if 40 <= y <= 99 else None
    return None


def main():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    cm_id = cur.execute("SELECT id FROM relation_types WHERE code='classmate'").fetchone()[0]

    # existing classmate pairs (idempotency)
    existing = set()
    for a, b in cur.execute(
        "SELECT actor_a, actor_b FROM relations WHERE type_id=?", (cm_id,)
    ):
        existing.add((a, b))

    rows = cur.execute("""
        SELECT id, name, school, enrollment_year FROM artists
        WHERE school IS NOT NULL AND school != ''
          AND enrollment_year IS NOT NULL AND enrollment_year != ''
    """).fetchall()

    groups = defaultdict(list)
    skipped = []
    for aid, name, school, enroll in rows:
        school = school.strip()
        y = parse_year(enroll)
        if y is None:
            skipped.append((name, enroll))
            continue
        groups[(school, y)].append((aid, name, enroll))

    inserted = 0
    skipped_pairs = 0
    for (school, y), members in sorted(groups.items()):
        members = sorted(members)
        if len(members) < 2:
            continue
        for i in range(len(members)):
            for j in range(i + 1, len(members)):
                a, b = sorted((members[i][0], members[j][0]))
                if (a, b) in existing:
                    skipped_pairs += 1
                    continue
                detail = f"{school} {y}级同学"
                cur.execute(
                    "INSERT INTO relations (type_id, actor_a, actor_b, detail, source_type, status, confidence) "
                    "VALUES (?,?,?,?,?,?,?)",
                    (cm_id, a, b, detail, "derived", "approved", 1.0),
                )
                inserted += 1

    conn.commit()
    cur.execute("SELECT COUNT(*) FROM relations WHERE type_id=?", (cm_id,))
    total = cur.fetchone()[0]
    conn.close()

    print(f"同学关系入库: 新增 {inserted} 对（已存在跳过 {skipped_pairs} 对）")
    print(f"classmate 关系总数: {total}")
    if skipped:
        print(f"无法解析入学年份、跳过 {len(skipped)} 人: {skipped}")


if __name__ == "__main__":
    main()
