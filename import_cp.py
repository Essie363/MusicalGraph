import sqlite3, re, os
from pathlib import Path

BASE = Path(__file__).resolve().parent  # 脚本所在目录 = 项目根
DB = BASE / "music_graph.db"

raw = """吴志军、徐杭 军杭
吴志军、赵钱龙 钱军出击
翟阳、钟嘉诚 钟嘉夜
徐丽东、叶麒圣 叶东
赵伟钢、钟嘉诚 钢好真路
郭嘉轩、钟嘉诚 钟花
毛二、徐昊 昊耀
汤佳明、许昌泰 国泰明安
徐杭、张智涵 太杭
叶麒圣、张泽 叶泽
邵玎、张智涵 太打
邵立君、钟嘉诚 君诚99
汤佳明、相征 相汤
纪晓坤、汤佳明 汤纪
李苏霖、祝颂皓 祝苏
田野、相征 野相
胥子含、张沁丹 丫蛋
余镇鳌、赵洪博 卜鳌
白倬铭、郑艺彬 丿彬
姜崃、朱亮 闪崃
李苏霖、徐昊 昊苏
冒海飞、王培杰 瑙
陈玉婷、丁辰西 婷西
高杨、张会芳 羊芳
毛二、钟嘉诚 钟二病
冒海飞、于晓璘 冒村
邵立君、徐佳文 文君
吴盛祥、徐佳文 文锌
钟嘉诚、钟舜傲 双钟
白倬铭、王瀚宇 丿重
白倬铭、王敏辉 丿娟
邓贤凌、赵雨卉 邓卉
高雨晨、郑艺彬 彬高
刘令飞、钟嘉诚 飞诚
刘朱烨、赵奕然 烨奕
刘子赫、薛钦元 刘薛
李存贤、邵奕磊 楠贤
李珏、于滨嘉 黑珏
卢翰林、邱俊阳 卢邱
毛二、汤佳明 汤猫
施博威、朱亚洲 bo朱
许昌泰、余镇鳌 余许
胥子含、赵雨卉 丫卉
叶宇锋、余镇鳌 锋里余里
尤宣程、龙一豪 尤龙
蔡淇、王敏辉 娟心蔡
崔恩尔、余思冉 恩冉
高杨、金圣权、张超 权超羊
高雨晨、叶筱玮 穹顶第一初恋
郭虹旭、纪晓坤 纪旭
郭虹旭、王敏辉 香娟
蒋倩如、徐瑶 情瑶
卢翰林、赵奕然 卢赵
邵立君、汤佳明 你的眼里只有朗和汤勺
沈育奇、叶宇锋 沈叶
孙一城、薛钦元 多元
汤佳明、徐昊 昊汤
田野、许昌泰 野泰
王瀚宇、王敏辉 娟玉
王瀚宇、祝颂皓 歪祝
薛钦元、诸葛北辰 传祺
徐杭、郑艺彬 杭彬
叶嘉雯、赵嘉艳 烟叶
张沁丹、赵嘉艳 烟熏蛋
赵凡嘉、郑艺彬 心动嘉彬
白倬铭、赵伟钢 丿钢
蔡淇、纪晓坤 鸡毛菜
陈志、朱亮 闪导
邓茹月、郭美冉 茹冉
郭耀嵘、刘乙萱 郭萱
郝李英杰、陈志 郝南志时态
黄雪煌、谭祖弘 谭黄
金圣权、张超 权倾朝野
林大钦、郑艺彬 饼面
刘子赫、薛钦元、欧阳乔子 刘薛乔
李存贤、吴以瀚 妹贤
李珏、王颢珏 珏珏
卢翰林、刘朱烨 卢烨
卢翰林、赵奕然、庞东轩 卢赵庞
毛二、张泽 泽猫
汤佳明、钟嘉诚 诚明在wer
吴杭律、赵雨卉 杭卉
许放星、张铎 铎星
赵伟钢、钟嘉诚 钢铁长城
白举纲、刘令飞 白令海峡
郭耀嵘、叶嘉雯 叶郭
顾易、纪晓坤 顾纪
姜崃、吴以瀚 妹妹
劳其森、梁景皓 景其
劳其森、南枫 枫森
毛二、杨皓晨 羊毛
蒲弘斐、张力夫 桃桶
邵奕磊、吴以瀚 妹桶
王浩楠、吴以瀚 妹桶
王敏辉、徐泽辉 双辉
徐均朔、郑棋元 元与均棋
许昌泰、卢翰林、沈育奇、余镇鳌、叶宇锋、赵洪博、李浩楠 星33动物园
叶嘉雯、张沁丹 茶叶蛋
张玮伦、钟嘉诚 玮你诚伦
郑艺彬、高雨晨、叶筱玮 彬高叶
姜崃、卢翰林 缺卢不明
刘晓邑、张志林 霸道晓邑俏志林"""

NAME_FIX = {
    "翟阳": "翟松", "翟阳": "翟松",
    "青子含": "胥子含", "胥子含": "胥子含",
    "冒海飞、于晓磷": "冒海飞、于晓璘",
    "吴盛锌": "吴盛祥",
    "邓凌滨": "邓贤凌",
    "刘朱婷": "刘朱烨",
    "刘子麒": "刘子赫",
    "朱正洲": "朱亚洲",
    "郭鸿旭": "郭虹旭",
    "王颜珏": "王颢珏",
    "李炜玲": "李炜铃",
    "王敬辉": "王敏辉",
    "王瑶": "王瑞",
    "陈芯": "陈志",
    "邓菽月": "邓茹月",
    "黄雪媛": "黄雪煌",
    "劳奇森": "劳其森",
    "琨茂林": "琚茂林",
    "蒲弘斐": "浦弘斐",
    "潘弘斐": "浦弘斐",
    "李颢": None,
    "马婕": None,
    "韦岸": None,
    "朱正": None,
    "李浩楠": None,
    "张志林": None,
    "刘晓邑": None,
}

conn = sqlite3.connect(DB)
cur = conn.cursor()

# Build name→id lookup
cur.execute("SELECT id, name FROM artists")
n2id = {}
for aid, nm in cur.fetchall():
    n2id.setdefault(nm, []).append(aid)

cp_type_id = cur.execute("SELECT id FROM relation_types WHERE code='cp'").fetchone()[0]

results = []
for line in raw.strip().split("\n"):
    line = line.strip()
    if not line:
        continue
    # Split: last space-separated token is CP name
    parts = line.rsplit(" ", 1)
    if len(parts) != 2:
        # Try single word line
        results.append(("PARSE_FAIL", line, None, None))
        continue
    actor_part, cp_name = parts[0].strip(), parts[1].strip()
    # Clean CP name
    cp_name = re.sub(r'\s*\(.*?\)\s*', '', cp_name).strip()
    # Parse actors
    actors = [a.strip() for a in re.split(r'[、，,]', actor_part) if a.strip()]
    # Fix names
    fixed = []
    for a in actors:
        if a in NAME_FIX:
            if NAME_FIX[a] is None:
                fixed = None
                break
            fixed.append(NAME_FIX[a])
        else:
            fixed.append(a)
    if fixed is None:
        results.append(("SKIP_ACTOR", line, actors, cp_name))
        continue

    # Match to DB
    matched = []
    failed = []
    for a in fixed:
        ids = n2id.get(a)
        if ids and len(ids) == 1:
            matched.append(ids[0])
        else:
            failed.append(a)
    if failed:
        results.append(("UNMATCHED", line, fixed, cp_name, failed))
        continue

    # Create relations (pairwise for 3+ actor groups too)
    for i in range(len(matched)):
        for j in range(i + 1, len(matched)):
            a, b = sorted((matched[i], matched[j]))
            cur.execute(
                "INSERT OR IGNORE INTO relations (type_id,actor_a,actor_b,detail,source_type,status,confidence) VALUES (?,?,?,?,?,?,?)",
                (cp_type_id, a, b, cp_name, "user", "approved", 1.0))

    results.append(("OK", cp_name, fixed, len(matched)))

conn.commit()

ok = [r for r in results if r[0] == "OK"]
fail = [r for r in results if r[0] != "OK"]
print(f"CPs stored: {len(ok)}, failed: {len(fail)}")
if fail:
    print("\n=== FAILED ===")
    for r in fail:
        print(f"  {r[0]}: {r[1][:80]}")

cur.execute("SELECT COUNT(*) FROM relations")
print(f"\nrelations total: {cur.fetchone()[0]}")
conn.close()
