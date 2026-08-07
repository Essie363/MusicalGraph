"""Generate a profile-filling template (CSV, UTF-8-BOM) for the most active
actors that still lack profiles, so the user can fill in data manually.

Output: data/profile_template.csv (Excel-friendly)
Columns match the artists table; name + id are pre-filled.
"""
import csv
import sqlite3
from pathlib import Path

BASE = Path(__file__).resolve().parent  # 脚本所在目录 = 项目根
DB = BASE / "music_graph.db"
OUT = BASE / "data" / "profile_template.csv"

LIMIT = 50  # 预填最活跃的缺口演员数量

HEADER = ["artist_id", "姓名", "昵称", "生日", "学校", "专业", "籍贯", "入学年份", "身高", "备注"]


def main():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    rows = cur.execute("""
        SELECT a.id, a.name, COUNT(sc.show_id) AS shows
        FROM artists a
        JOIN show_casts sc ON a.id = sc.artist_id
        WHERE a.nickname IS NULL AND a.birth_date IS NULL AND a.major IS NULL
          AND a.school IS NULL AND a.hometown IS NULL AND a.enrollment_year IS NULL
          AND a.height IS NULL AND a.note IS NULL
        GROUP BY a.id
        ORDER BY shows DESC
        LIMIT ?
    """, (LIMIT,)).fetchall()

    with open(OUT, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(HEADER)
        for aid, name, shows in rows:
            w.writerow([aid, name, "", "", "", "", "", "", "", ""])

    print(f"已生成 {OUT}")
    print(f"预填 {len(rows)} 位最活跃的缺口演员（按演出场次排序，第一位: {rows[0][1] if rows else '-'}）")
    print("填写说明：保留 artist_id 和姓名；在对应列填写资料（生日格式如 1995/2/28 或 1995年2月28日；学校写全称）")
    conn.close()


if __name__ == "__main__":
    main()
