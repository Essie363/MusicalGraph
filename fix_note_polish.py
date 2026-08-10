"""备注清理第二轮：处理含 演员/音乐剧 冗余措辞的剩余备注（2026-08-10）。

注意：本项目存在大量同名演员，所有 UPDATE 一律按 id 或「精确备注值」匹配，
绝不按 name 匹配（曾因 name='王婷' 误伤 3 人，已按 id 修正）。
"""
import sqlite3
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
DB = Path(__file__).resolve().parent / "music_graph.db"
conn = sqlite3.connect(DB)
cur = conn.cursor()

# 1) 纯冗余 -> 删除（按精确备注值匹配，安全）
cur.execute("UPDATE artists SET note = NULL WHERE note = '演员; 中国音乐剧演员'")
print("删除 田野(演员; 中国音乐剧演员):", cur.rowcount)
cur.execute("UPDATE artists SET note = NULL WHERE note = '音乐剧演员; 音乐剧演员'")
print("删除 赵伟钢(音乐剧演员; 音乐剧演员):", cur.rowcount)

# 2) 冗余前缀/后缀 -> 剥离（按 id 精确匹配）
cur.execute("UPDATE artists SET note = REPLACE(note, '音乐剧演员；', '') WHERE id = 482")
print("剥离 朱微之(482) 前缀:", cur.rowcount)
cur.execute("UPDATE artists SET note = REPLACE(note, '，是中国音乐剧演员', '') WHERE id = 274")
print("剥离 张沁丹(274) 后缀:", cur.rowcount)

# 3) 迁入 role（按 id 精确匹配）
cur.execute("UPDATE artists SET role = '编舞、巡演导演', note = NULL WHERE id = 130")
print("王婷(130) -> role:", cur.rowcount)
cur.execute("UPDATE artists SET role = '女高音/音乐剧主任', note = NULL WHERE id = 2409")
print("王莉(2409) -> role:", cur.rowcount)
cur.execute("UPDATE artists SET role = '歌手/音乐制作人', note = NULL WHERE name = '鞠红川' AND id = (SELECT MIN(id) FROM artists WHERE name = '鞠红川')")
print("鞠红川 -> role:", cur.rowcount)
cur.execute("UPDATE artists SET role = '副团长/国家一级演员', note = '东方演艺集团' WHERE id = 384")
print("喻越越(384) -> role + note:", cur.rowcount)

conn.commit()
conn.close()
print("完成（幂等说明：本脚本已执行过，再次运行会重复计数但结果一致）")