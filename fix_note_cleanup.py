"""备注字段清理：删除无价值职业标签，其余有价值信息迁移到对应字段。

规则（2026-08-10，经用户确认）：
  1. 删除  —— 音乐剧/演员/女演员/男演员/音乐/表演/内地/年轻 等冗余职业标签（项目本身即音乐剧演员库）
  2. 职务  —— 灯光/舞美/音响/编剧/导演/作曲 等幕后工种 -> 新增 role 字段
  3. 昵称  —— 别名/真名/曾用名（如 奇煜->张超）-> nickname 字段
  4. 籍贯  —— 地名（美国/柳州/武汉 等）-> hometown 字段
其余（单位/教育/简介/声部等）保留在 note。

执行前请确认已备份 music_graph.db（music_graph_backup_20260810.db）。
"""
import sqlite3
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
BASE = Path(__file__).resolve().parent
DB = BASE / "music_graph.db"

# ---------- 分类桶（值 = 原 note 的精确值） ----------
DELETE = [
    "音乐剧", "演员", "女演员", "男演员", "音乐", "表演",
    "内地", "年轻", "新生代演员", "女主创", "校友", "四川演员",
]
ROLE = [
    "灯光", "舞美", "音响", "编剧", "编舞", "作曲", "服化", "导演",
    "多媒体", "道具", "编曲", "多媒体设计", "造型", "音响设计", "服装",
    "音效", "音效设计", "服装造型", "服装设计", "舞蹈编导", "服化造型",
    "声音设计", "作词", "造型设计", "灯光设计", "舞台设计", "妆造", "词曲",
    "导演/编剧", "男编剧", "舞蹈", "舞者", "音乐总监", "武术表演",
    "英语翻译", "视频设计", "导演/编舞", "舞台监督", "形体/编舞",
    "服装造型设计", "机关设计", "舞美道具", "戏偶", "舞美设计", "妆发",
    "化妆设计", "演员、编剧", "导演、编舞", "舞美多媒体", "舞美灯光",
    "上话灯光", "京谣制作人", "京谣出品人", "配音演员", "视频", "装置",
    "副教授",
]
NICKNAME = [
    "张大可", "张超", "张苒", "宋宇宁", "庞凯航", "张鑫", "大雨桐", "小雨桐",
    "张哲豪", "李恩妤", "杨东青", "杨闻洲", "王晓佳", "王芯芯", "王雨姝",
    "中国BOY", "皮溢晗", "缪雨墨", "方圆", "赵俊铖", "陈凯", "方潇亦",
    "黄欣靓", "齐齐",
]
# 别名类但备注超过 6 字（按 name 匹配）
NICKNAME_BY_NAME = {
    "康國鉉（韩）": "KOOKHYUN KANG",
    "尔江": "依孜哈尔江·衣明江",
    "李嘉笛FeiJi": "李沫萱Feiji",
}
HOMETOWN = [
    "美国", "柳州", "德国", "南京", "武汉", "宝鸡", "台湾", "澳门", "［英］", "【韩】",
]


def main():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    # 0) 新增 role 字段（幂等）
    cols = [r[1] for r in cur.execute("PRAGMA table_info(artists)")]
    if "role" not in cols:
        cur.execute("ALTER TABLE artists ADD COLUMN role TEXT")
        print("已新增列: artists.role")

    def count(notes):
        if not notes:
            return 0
        q = "SELECT COUNT(*) FROM artists WHERE note IN (%s)" % ",".join("?" * len(notes))
        return cur.execute(q, notes).fetchone()[0]

    print("\n== 迁移前 ==")
    print("待删除备注:", count(DELETE))
    print("待迁往职务:", count(ROLE))
    print("待迁往昵称:", count(NICKNAME) + len(NICKNAME_BY_NAME))
    print("待迁往籍贯:", count(HOMETOWN))

    # 1) 删除
    cur.executemany("UPDATE artists SET note = NULL WHERE note = ?", [(n,) for n in DELETE])
    print("已删除冗余职业标签:", cur.rowcount)

    # 2) 职务
    cur.executemany("UPDATE artists SET role = note, note = NULL WHERE note = ?", [(n,) for n in ROLE])
    print("已迁往职务字段:", cur.rowcount)

    # 3) 昵称（精确值 + 按 name）
    n = 0
    cur.executemany(
        "UPDATE artists SET nickname = note, note = NULL WHERE note = ? AND (nickname IS NULL OR TRIM(nickname) = '')",
        [(v,) for v in NICKNAME])
    n += cur.rowcount
    for name, alias in NICKNAME_BY_NAME.items():
        cur.execute(
            "UPDATE artists SET nickname = ?, note = NULL WHERE name = ? AND (nickname IS NULL OR TRIM(nickname) = '')",
            (alias, name))
        n += cur.rowcount
    print("已迁往昵称字段:", n)

    # 4) 籍贯
    cur.executemany(
        "UPDATE artists SET hometown = note, note = NULL WHERE note = ? AND (hometown IS NULL OR TRIM(hometown) = '')",
        [(v,) for v in HOMETOWN])
    print("已迁往籍贯字段:", cur.rowcount)

    conn.commit()

    # 迁移后检查
    remaining = cur.execute(
        "SELECT note, COUNT(*) FROM artists WHERE note IS NOT NULL AND TRIM(note) != '' GROUP BY note ORDER BY COUNT(*) DESC"
    ).fetchall()
    print("\n== 迁移后：保留在备注的 %d 种 ==" % len(remaining))
    for note, c in remaining:
        print("  %3d  %s" % (c, note[:60]))
    conn.close()


if __name__ == "__main__":
    main()