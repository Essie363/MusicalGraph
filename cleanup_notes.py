"""Clean up note column: extract school info → merge to school, fix known errors."""
import sqlite3, re
from pathlib import Path

BASE = Path(__file__).resolve().parent  # 脚本所在目录 = 项目根
DB = BASE / "music_graph.db"

SCHOOL_EXPAND = {
    "上音": "上海音乐学院", "中戏": "中央戏剧学院", "上戏": "上海戏剧学院",
    "北舞": "北京舞蹈学院", "上视觉": "上海视觉艺术学院",
    "浙音": "浙江音乐学院", "星海": "星海音乐学院", "川音": "四川音乐学院",
    "南艺": "南京艺术学院", "天音": "天津音乐学院", "沈音": "沈阳音乐学院",
}

# patterns to detect if a note contains school info
SCHOOL_KW = ["戏剧学院", "音乐学院", "舞蹈学院", "艺术学院", "电影学院",
             "音乐剧系", "表演系", "传媒学院", "传媒大学", "教授", "副教授",
             "上音", "中戏", "上戏", "北舞", "上视觉", "浙音", "星海", "川音",
             "南艺", "天音", "沈音"]


def has_school(text):
    return any(k in text for k in SCHOOL_KW)


def extract_school_from_note(note):
    """Return (school_part, rest_of_note) from a mixed note like '女演员上音'"""
    # Try to match known patterns
    for abbr, full in SCHOOL_EXPAND.items():
        if abbr in note:
            return full, note.replace(abbr, "").strip("，, ")
    # Full school names
    for pat in ["上海戏剧学院", "北京舞蹈学院", "北京电影学院",
                "中央戏剧学院", "上海音乐学院", "上海视觉艺术学院",
                "浙江音乐学院", "星海音乐学院", "四川音乐学院",
                "南京艺术学院", "天津音乐学院", "沈阳音乐学院"]:
        if pat in note:
            return pat, note.replace(pat, "").strip("，, ")
    # Generic patterns like "音乐剧系" or "音乐剧主任"
    if "音乐剧" in note or "表演系" in note or "教授" in note or "副教授" in note:
        return note.strip("，, "), None
    return None, note


def fix_note_and_school():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    logs = []

    rows = cur.execute("SELECT id, name, note, school FROM artists WHERE note IS NOT NULL").fetchall()

    for aid, name, note, existing_school in rows:
        if not note:
            continue

        new_note = note
        new_school = existing_school

        # Check if note contains school info
        if has_school(note):
            school_part, rest = extract_school_from_note(note)
            if school_part:
                # Merge: prefer non-abbreviated school if both exist
                if existing_school:
                    # Keep existing school if it's more specific, or merge if new is better
                    existing_brief = existing_school in SCHOOL_EXPAND.values()
                    new_brief = school_part in SCHOOL_EXPAND.values()
                    if not existing_brief and new_brief:
                        new_school = school_part  # prefer full name
                    # else keep existing
                else:
                    new_school = school_part
            new_note = rest

        # Keep all non-school notes for disambiguation (same-name, job role, location, gender)
        # Do NOT remove "演员/男演员/女演员" — they disambiguate same-name artists

        # Update
        if new_note != note or new_school != existing_school:
            cur.execute("UPDATE artists SET note=?, school=? WHERE id=?",
                        (new_note, new_school, aid))
            logs.append(f"  {name}({aid}): note '{note}'→{new_note}  school '{existing_school}'→'{new_school}'")

    conn.commit()

    # Fix known errors
    # 1. enrollment_year that contains group/CP tags
    bad_enroll = cur.execute(
        "SELECT id,name,enrollment_year FROM artists WHERE enrollment_year IS NOT NULL").fetchall()
    fixes = []
    for aid, name, enroll in bad_enroll:
        if enroll and any(tag in enroll for tag in [
            "娟心蔡", "云次方", "香娟", "权超羊", "纪汤", "祝苏", "谭黄",
            "烨奕", "J娟", "J彬", "闪嵘", "妹嵘", "饼面", "弯顶", "彬高叶", "璎",
            "330", "409", "605", "213", "211", "6009", "丫蛋", "枫森", "景其",
            "卢赵彪", "卢叶", "闪导", "郭萱", "郭叶", "siva6009"
        ]):
            # this enrollment looks like a group tag → it was misaligned due to empty columns
            fixes.append((aid, name, enroll))
            cur.execute("UPDATE artists SET enrollment_year=NULL WHERE id=?", (aid,))
            conn.commit()
            logs.append(f"  FIX {name}({aid}): enrollment_year='{enroll}' → NULL (was group tag)")

    conn.commit()
    return logs, fixes


logs, fixes = fix_note_and_school()
for l in logs:
    print(l)
print(f"\ntotal changes: {len(logs)}")
