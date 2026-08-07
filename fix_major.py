# -*- coding: utf-8 -*-
"""清理 artists.major：只保留"专业"，学校/年级/其他信息各归各位。

规则：
- 人工映射优先（MANUAL 表）
- 通用规则：从 major 中提取学校 -> school（仅当 school 为空时填入）、
  年级(20XX级/20XX年) -> enrollment_year（仅当为空时填入）、
  专业核心(X专业/X系/X本科/X硕士/X演唱) -> 保留在 major，
  其余文本并入 note（已有 note 时追加）。
"""
import sqlite3, re, sys, io
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = Path(__file__).resolve().parent
DB = BASE / "music_graph.db"

# name -> (major, school, enrollment_year, note)
#   major 必填；school/enroll 为 None 表示保持现状（只在为空时尝试自动提取）
#   note: None=保持现状/自动合并；""=清空；其他字符串=直接设置
MANUAL = {
    "钱蒙楠": ("音乐剧表演与教育专业", "上海视觉艺术学院", "2019级",
               "2022年11月参演毕业大戏《妈妈再爱我一次》(青春版)，饰演老搭档和舞厅经理"),
    "杜鑫艳": ("声歌系", "西安音乐学院", None,
               "2009年进入北京现代音乐研修学院欧美系就读"),
    "桑可舟": ("导演系影视表演专业", "中国戏曲学院", None, None),
    "王逸飞": ("现代音乐表演专业", None, None, None),
    "李玉言": ("舞蹈表演专业", "吉林艺术学院", None, None),
    "郭亢":   ("音乐剧系", "上海音乐学院", "2013级", ""),
    "陈科铭": ("音乐剧专业", "星海音乐学院", None, "在读研究生"),
    "朱亮":   ("音乐剧演唱艺术硕士", None, None, None),
    "赵钱龙": ("表演(音乐剧)专业", None, None, "校友"),
    "钟嘉诚": ("音乐剧本科", "上海戏剧学院", "2016级", None),
    "徐杭":   ("音乐剧专业", "浙江音乐学院", "2019级",
               "2017年9月至2019年6月高中就读于杭州西子实验学校"),
    "刘乙萱": ("音乐剧/音乐剧(硕士)", None, None, None),
    "何铭海": ("音乐剧专业", None, None, None),
    "杜钇樵": ("流行演唱", None, None, "南京传媒学院硕士"),
    "曹牧之": ("表演系", None, None, ""),
}

SCHOOLS = ["上海戏剧学院","上海音乐学院","中央戏剧学院","北京舞蹈学院","北京电影学院",
           "中国戏曲学院","南京艺术学院","星海音乐学院","四川音乐学院","浙江音乐学院",
           "西安音乐学院","华东师范大学","杭州师范大学","吉林艺术学院","青岛大学",
           "南京传媒学院","中国传媒大学","山东艺术学院","沈阳音乐学院","天津音乐学院",
           "上海视觉艺术学院","北京现代音乐研修学院"]

def clean_note_part(s):
    if not s:
        return None
    s = s.strip(" \t，,。、；;/\u3000")
    return s or None

def generic_clean(major):
    s = major
    sch = None
    for sc in SCHOOLS:
        if sc in s:
            sch = sc
            s = s.replace(sc, "").strip("，,。、 ")
            break
    s = re.sub(r"^(毕业于|就读于|考入|曾在|于)", "", s).strip("，,。、 ")
    enroll = None
    m = re.search(r"(20\d{2}级|20\d{2}年)", s)
    if m:
        enroll = m.group(1)
        s = s.replace(m.group(1), "").strip("，,。、 ")
    m = re.search(r"((?:音乐剧|音乐戏剧|音乐表演|音乐|表演|声乐|舞蹈|导演|影视|现代音乐|流行演唱|欧美|新闻|化学)[^，,。；;]*?(?:专业|系|本科|硕士|演唱))", s)
    if m:
        prof = m.group(1).strip("，,。、 ")
        rest = (s[:m.start()] + s[m.end():]).strip("，,。、 ")
        rest = re.sub(r"^(校友|在读)", "", rest).strip("，,。、 ")
        return prof, sch, enroll, clean_note_part(rest)
    return None, sch, enroll, clean_note_part(major)

# 出生日期字段被误填成学校的记录（school 字段已含同样信息，直接清空 birth_date）
BIRTH_CLEAR = ["黄可", "刘乙萱", "洪果", "孙欣业", "孙礼杰", "亓振源"]

c = sqlite3.connect(DB)
cur = c.cursor()
rows = cur.execute("SELECT id, name, major, school, enrollment_year, note FROM artists WHERE major IS NOT NULL AND major != '' ORDER BY id").fetchall()

updated = []
for aid, name, major, school, enroll, note in rows:
    if name in MANUAL:
        new_major, sch_f, en_f, note_f = MANUAL[name]
        new_note_part = None
    else:
        new_major, sch_f, en_f, new_note_part = generic_clean(major)
        note_f = None

    new_school = school
    if sch_f and (not school or name == "杜鑫艳"):
        new_school = sch_f
    new_enroll = enroll
    if en_f and not enroll:
        new_enroll = en_f

    if note_f == "":
        new_note = None
    elif note_f:
        new_note = note_f
    else:
        if new_note_part:
            if not note:
                new_note = new_note_part
            elif new_note_part in note:
                new_note = note
            else:
                new_note = note + "；" + new_note_part
        else:
            new_note = note

    cur.execute("UPDATE artists SET major=?, school=?, enrollment_year=?, note=? WHERE id=?",
                (new_major, new_school, new_enroll, new_note, aid))
    updated.append((name, major, new_major, school, new_school, enroll, new_enroll, note, new_note))

for name in BIRTH_CLEAR:
    cur.execute("UPDATE artists SET birth_date=NULL WHERE name=?", (name,))

c.commit()

print("=== 清理完成，共更新", len(updated), "人 ===")
for name, om, nm, os_, ns, oe, ne, on_, nn in updated:
    changed = []
    if om != nm: changed.append(f"major: {om!r} -> {nm!r}")
    if os_ != ns: changed.append(f"school: {os_!r} -> {ns!r}")
    if oe != ne: changed.append(f"enroll: {oe!r} -> {ne!r}")
    if on_ != nn: changed.append(f"note: {on_!r} -> {nn!r}")
    if changed:
        print(f"\n{name}:")
        for ch in changed:
            print("   ", ch)
print("\n出生日期误填学校已清空:", BIRTH_CLEAR)
c.close()
