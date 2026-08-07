import sqlite3, re, json, os
from pathlib import Path

BASE = Path(__file__).resolve().parent  # 脚本所在目录 = 项目根
DB = BASE / "music_graph.db"

raw = """范景玥
高崇	2002/11/16	上海音乐学院	音乐剧		2021级本
高巧荣	(钢琴)
郭美冉
郭耀嵘	1992/11/23	上海戏剧学院	音乐剧	辽宁大连	2012级	郭萱、郭叶
杭筱玥
何若水
洪果		中央戏剧学院(本硕)	音乐剧	河北承德	2017级	中戏17
黄可	可可子	上海音乐学院	音乐剧		2020级
黄雨蝶	2001/2/17	四川音乐学院
蒋倩如	1984/7/14	上海音乐学院		2002级
廖婧媛
林润欣	2003/6/30	上海音乐学院(硕士)		江苏淮安	2025级
林忆欣	2001/9/22	韩国汉阳大学	表演专业	福建
刘浩冉
刘乙萱		上海音乐学院/英国皇家中央演讲与戏剧学院(硕士)	音乐剧/音乐剧(硕士)	黑龙江牡丹江
刘昱含	1999/11/20	上海视觉艺术学院/上海音乐学院(硕士)	音乐剧	浙江	2017级
柳智彦	3月12日	上海戏剧学院			2017级	上戏17
李恩妤
李炜铃	铃铃紫紫		上海音乐学院(博士)	音乐剧声乐专业
黎玥杉	秋秋		上海音乐学院	音乐剧		2021级
李泽美	2002/10/16	波兰国立肖邦音乐大学	声乐表演
娄睿
马小乔	2000/5/5	北京舞蹈学院	音乐剧		2017级
苗梦初
明家歆	小明	1999/5/3	中央戏剧学院	话剧影视表演
年蔓婷	1993/3/23
潘珏辰
强东玥
钱安琪	麦麦	1999/11/28	上海音乐学院(本硕)	音乐剧	浙江
沈蕾	(钢琴)
孙航	(小提琴)
苏诗丁
王瀚宇
王洁璐	1996/7/31	上海音乐学院(本硕)	音乐剧	上海
王竞琦	2001/8/22	四川音乐学院		山东日照
王俊迪
王琰婕	(小提琴)
魏佳源
吴杭律
谢文校
徐丽东	HSU,LI-TONG	8月17日			浙江温州
徐瑶	1990/9/1	北京舞蹈学院	音乐剧	山西大同	2007级
徐郑凯伊	2004/8/16	上海视觉艺术学院	音乐剧	东北人	2022级
胥子含	1997/9/30	复旦大学/Johns Hopkins (硕士)	化学系/材料学(硕士)	浙江杭州		丫蛋
杨依冷	2000/10/26	中央戏剧学院/英国皇家音乐学院	音乐剧 (本硕)	广东	2018级本科
颜嘉萱	(钢琴)			中国台湾
严小北
叶嘉雯	Miya	1998/10/31	上海音乐学院		厦门	2017级	叶烟
余宏	(钢琴)
余思冉	1996/12/4	上海视觉艺术学院	音乐剧		2014级
张会芳	1996/3/5	北京现代音乐研修学院	音乐剧	河南
张沁丹	禽蛋	1997/7/24	上海戏剧学院	音乐剧	湖北宜昌	2015级	丫蛋、烟熏茶叶蛋、烟蛋
张雨桐	2002/5/24	四川音乐学院	音乐剧		2020级
赵嘉艳	烟酱	1990/10/9	上海外国语大学	国际经济与贸易	上海		叶烟、烟蛋、烟熏茶叶蛋
赵雨卉	1996/3/14	上海音乐学院	音乐剧	江苏南京	2014级本科/2018级硕士	邓卉、丫卉、杭卉
郑涵一	2001/11/25	上海音乐学院	音乐剧	吉林长春	2020级 (好像)
钟楚依
左一平	1993/3/3	上海外国语大学	英语翻译	吉林长春
冒海飞	企鹅	1987/11/9	南京艺术学院	音乐剧	江苏南通	2005级	175
南枫	1991/10/6	美国西北大学、耶鲁大学双硕士
倪晔	1983/7/17
浦弘斐	2002/11/3	中央戏剧学院	音乐剧	辽宁大连	2021级	中戏21, 182
钱蒙楠	2000/11/11	上海视觉艺术学院	音乐剧与教育		2019级	siva6009
钱琪超
邱俊阳	QQ	2002/10/20	浙江音乐学院	音乐剧	山东淄博	2021级	浙音211, 187
亓振源		上海视觉艺术学院	音乐剧		2020级	siva20 1001
桑可舟
邵玎	打帝	1997/4/26	上海音乐学院	音乐剧	上海	2014级
邵立君	沙拉酱	2001/1/24	上海视觉艺术学院	音乐剧与教育	上海	2019级	siva6009, 明立, 君诚
邵奕磊	桶	1998/11/29	中央戏剧学院	音乐剧	上海	2017级	中戏17、桶贵、妹桶
申申
沈育奇	奇奇, 兔	2002/10/15	上海音乐学院	音乐剧	上海	2021级	星33动物园, 180
施博威	Boby	1996/11/10	杭州师范大学	音乐表演	浙江台州
施哲明	三老师	4月9日
舒荣波	2001/3/10	上海视觉艺术学院	音乐剧	四川成都
舒杨
宋元明	1999/7/27	北京舞蹈学院	音乐剧	河南平顶山	2018级	北舞18
孙豆尔
孙礼杰		上海音乐学院 (硕士)	音乐剧声乐硕士
孙欣业		上海戏剧学院			2018级	上戏18
孙一城	多多	1999/11/30	北京舞蹈学院			2018级	北舞18, 多元, 183
汤佳明	比格	2000/11/5	上海视觉艺术学院	音乐剧与教育	浙江宁波象山	2019级	siva6009, 纪汤, 明立, 国泰明安, 汤相
谭祖弘	蒙面鸟人	2021/2/14			广东		186
滕春鹏	tcp	1993/3/11	上海视觉艺术学院		山东		187
田野	田野怪天气	1997/5/4	上海视觉艺术学院
田宇铮	(吉他)
王瀚宇	歪	1990/11/5	天津音乐学院		天津		歪祝
王颢珏	1996/3/29	华东师范大学/上海音乐学院 (硕士)
王浩楠	1999/7/31	中央戏剧学院	音乐剧		2017级	中戏17
王敏辉	米菲	1996/10/19	上海音乐学院	音乐剧	浙江义乌	2015级	上音409、娟心蔡, 双辉, J娟, 香娟, 娟心蔡, 188
王培杰	PJ	1989/9/2	北京电影学院	表演系	山东东营		瑁, 184
王瑞	小丸子/瑞子	2001/11/8	南京艺术学院	音乐剧	江苏淮安
王天择	1999/2/26	中央戏剧学院	表演	上海	2017级	中戏17
王喆
王智威	1995/10/18	浙江音乐学院	流行演唱
魏诗泉
魏忠杰	tbc	2004/5/17	上海音乐学院	音乐剧		2022级
吴盛祥	鱼书	2001/10/10	上海体育大学	武术表演	安徽阜阳	2022级
吴以瀚	妹妹	1997/3/10	中央戏剧学院	音乐剧		2017级	中戏17, 妹嵘、妹桶、妹瑞、妹楠
吴志军	1998/11/9	浙江传媒学院	音乐剧	浙江台州		军杭、钱军
相征	0516	2000/5/16	上海戏剧学院	音乐剧	山东日照	2018级	上戏18, 相汤
肖德俊	1999/8/8	上海戏剧学院	音乐剧	广东东莞	2017级	上戏17
夏阳
许昌泰	驼	2001/6/24	上海视觉艺术学院	音乐剧与教育	广东深圳	2019级	siva6009, 国泰明安
徐杭	阿点	2000/9/16	浙江音乐学院		浙江杭州	2019级	军杭, 182
徐昊	xhr	1995/8/20	山东艺术学院	音乐教育			昊猫
徐佳文	Gavin	1999/6/22	南京艺术学院	音乐剧
徐均朔	1996/12/11	上海音乐学院	音乐剧	福建	2015级	上音407, 178
徐泽辉	1997/5/13	上海音乐学院	音乐剧	上海	2015级	上音409, 双辉, 184
杨皓晨	2000/2/10	四川音乐学院			180
闫士俊
叶麒圣	174, yeg	1990/4/17	上海视觉艺术学院	表演系	四川南充	2010级
叶筱玮	1997/2/5	中央戏剧学院	表演系	江苏南京	2015级	穹顶第一初恋, 彬高叶, 185
叶宇锋	2002/3/22	上海视觉艺术学院	音乐剧		2020级	siva20 1001, 卢叶, 183
殷浩伦	1992/4/21	中央音乐学院	声歌剧	辽宁抚顺
于滨嘉	小黑	2001/6/10	上海音乐学院		吉林长春
余笛	1981/11/23
遇泓羊	1991/8/8	上海戏剧"""


def is_date(cell):
    return bool(re.match(r'^\d{4}[-/]\d{1,2}[-/]\d{1,2}$', cell) or
                re.match(r'^\d{4}年\d{1,2}月\d{1,2}日$', cell) or
                re.match(r'^\d{1,2}月\d{1,2}日$', cell) or
                re.match(r'^\d{4}[-/]\d{1,2}[-/]\d{1,2}$', cell))


def is_height(cell):
    return bool(re.match(r'^1[5-9]\d(\.\d)?$', cell))


def parse_line(line):
    line = line.strip()
    if not line:
        return None
    parts = line.split("\t")
    if not parts[0].strip():
        return None
    # normalize: detect if nickname column is missing (part[1] looks like birth_date)
    offset = 0
    if len(parts) > 1 and is_date(parts[1]):
        offset = 1
    data = list(parts)
    if offset:
        data.insert(1, "")

    def get(i):
        return data[i].strip() if i < len(data) and data[i].strip() else None

    name = get(0)
    if not name:
        return None
    # skip musicians
    for kw in ["(钢琴)", "(小提琴)", "(贝斯)", "(萨克斯)", "(吉他)"]:
        if kw in name or (len(data) > 1 and kw in data[1]):
            return None

    # Parse final column: extract group tags and heights
    last = get(7) or ""
    tags = []
    height = None
    for piece in re.split(r'[、，, ]+', last):
        piece = piece.strip()
        if not piece:
            continue
        if is_height(piece):
            height = piece
        else:
            tags.append(piece)

    return {
        "name": name,
        "nickname": normalize_nick(get(1)),
        "birth_date": get(2),
        "school": get(3),
        "major": get(4),
        "hometown": get(5),
        "enrollment": get(6),
        "tags": tags,
        "height": height,
    }


def normalize_nick(nick):
    if not nick:
        return None
    # extract pure nickname from parenthetical notes
    nick = nick.strip()
    # Remove short parenthetical like "(id)", "(微博名)" etc
    nick = re.sub(r'\s*\(.*?\)\s*', '', nick).strip()
    if not nick:
        return None
    return nick


records = [parse_line(l) for l in raw.strip().split("\n")]
records = [r for r in records if r]

# dedupe by name, merge
merged = {}
for r in records:
    k = r["name"]
    if k in merged:
        old = merged[k]
        for f in ["nickname", "birth_date", "school", "major", "hometown", "enrollment", "height"]:
            if r.get(f) and not old.get(f):
                old[f] = r[f]
        old["tags"] = list(set(old.get("tags", []) + r.get("tags", [])))
    else:
        merged[k] = dict(r)
        merged[k]["tags"] = list(r.get("tags", []))
records = list(merged.values())

conn = sqlite3.connect(DB)
cur = conn.cursor()

# Columns
for col, ctype in [
    ("nickname", "TEXT"), ("birth_date", "TEXT"), ("hometown", "TEXT"),
    ("enrollment_year", "TEXT"), ("school", "TEXT"), ("height", "TEXT"),
]:
    try:
        cur.execute(f"ALTER TABLE artists ADD COLUMN {col} {ctype}")
    except sqlite3.OperationalError:
        pass

cur.execute("SELECT id, name FROM artists")
name2ids = {}
for aid, aname in cur.fetchall():
    name2ids.setdefault(aname, []).append(aid)

matched, unmatched, updated = 0, [], 0
tags_all = json.load(open(os.path.join(BASE, "data", "group_cp_tags.json"), encoding="utf-8"))

for r in records:
    nm = r["name"]
    ids = name2ids.get(nm)
    if not ids:
        unmatched.append(nm)
        continue
    if len(ids) > 1:
        continue
    aid = ids[0]
    matched += 1
    for fkey, col in [("nickname", "nickname"), ("birth_date", "birth_date"),
                       ("school", "school"), ("hometown", "hometown"),
                       ("enrollment", "enrollment_year"), ("height", "height")]:
        val = r.get(fkey)
        if val:
            cur.execute(f"UPDATE artists SET {col}=? WHERE id=?", (val, aid))
            updated += 1
    # tags
    for t in r.get("tags", []):
        if t and len(t) <= 12:
            tags_all.append({"name": nm, "artist_id": aid, "group_tag": t})

conn.commit()

with open(os.path.join(BASE, "data", "group_cp_tags.json"), "w", encoding="utf-8") as f:
    json.dump(tags_all, f, ensure_ascii=False, indent=1)

print(f"matched: {matched}, updated fields: {updated}, unmatched: {len(unmatched)}")
print("unmatched:", unmatched)

# verify a few
for nm in ["施博威", "徐昊", "王敏辉", "赵雨卉", "张沁丹", "汤佳明", "吴以瀚"]:
    ids = name2ids.get(nm)
    if ids and len(ids) == 1:
        cur.execute("SELECT name,nickname,birth_date,school,hometown,enrollment_year,height FROM artists WHERE id=?", (ids[0],))
        print(cur.fetchone())

# Verify 遇泓羊 (incomplete line)
print("遇泓羊:", name2ids.get("遇泓羊"))

conn.close()
print("done, tags:", len(tags_all))
