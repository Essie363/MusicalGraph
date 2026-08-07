"""Parse user-submitted actor profile data (tab-separated, 9 columns):
  姓名 昵称 生日 毕业院校 专业 籍贯 入学年份 团伙 身高
  Match to database, update profiles, record group/CP relations.
"""
import re
import sqlite3
import os
from pathlib import Path

BASE = Path(__file__).resolve().parent  # 脚本所在目录 = 项目根
DB = BASE / "music_graph.db"

raw = r"""曹蘅	2003/3/16
程晨	2004/9/7	上海戏剧学院	音乐剧	深圳	2022级
陈思宇	CC	2002/7/10	北京舞蹈学院	音乐剧	山西	2021级
陈檀雅			中央戏剧学院	音乐剧		2021级
陈恬	2002/4/18	北京舞蹈学院	音乐剧	浙江温州	2020级
陈旭	1997/2/15	上海视觉艺术学院		黑龙江哈尔滨	
陈旭				
陈玉婷	老妹儿	2000/8/8	南京艺术学院	音乐剧	福建厦门	2018级
崔恩尔	1990/1/21	上海戏剧学院	音乐剧	辽宁沈阳	2008级
党韫葳	1987/10/26	上海音乐学院 (本硕)	音乐剧		
邓茹月						
邓贤凌			四川音乐学院	音乐剧	重庆	
丁辰西	1991/5/19	浙江大学	新闻系	北京	
丁臻滢	丁丁姐	1989/7/9	上海音乐学院	音乐剧	上海	
杜鑫艳						
范景玥						
高崇	2002/11/16	上海音乐学院	音乐剧		2021级本科/2025级硕士
高巧柔	(钢琴)				中国台湾	
郭美冉						
郭耀嵘	1992/11/23	上海戏剧学院	音乐剧	辽宁大连	2012级	郭萱、郭叶	
杭筱玥						
何若水						
洪果			中央戏剧学院 (本硕)	音乐剧	河北承德	2017级	中戏17	
黄可	可可子		上海音乐学院	音乐剧		2020级	
黄雨蝶	2001/2/17	四川音乐学院					
蒋倩如	1984/7/14	上海音乐学院			2002级	
廖婧媛						
林润欣	2003/6/30	上海音乐学院 (硕士)		江苏淮安	2025级	
林忆欣	2001/9/22	韩国汉阳大学	表演专业	福建		
刘浩冉						
刘乙萱			上海音乐学院/英国皇家中央演讲与戏剧学院 (硕士)	音乐剧/音乐剧 (硕士)	黑龙江牡丹江		
刘昱含	1999/11/20	上海视觉艺术学院/上海音乐学院 (硕士)	音乐剧	浙江	2017级	
柳智彦	3月12日	上海戏剧学院			2017级	上戏17	
李恩妤						
李炜铃	铃铃紫紫		上海音乐学院 (博士)	音乐剧声乐专业			
黎玥杉	秋秋		上海音乐学院	音乐剧		2021级	
李泽美	2002/10/16	波兰国立肖邦音乐大学	声乐表演			
娄睿						
马小乔	2000/5/5	北京舞蹈学院	音乐剧		2017级	
苗梦初						
明家歆	小明	1999/5/3	中央戏剧学院	话剧影视表演			
年蔓婷	1993/3/23					
潘珏辰						
强东玥						
钱安琪	麦麦	1999/11/28	上海音乐学院 (本硕)	音乐剧	浙江		
沈蕾	(钢琴)						
孙航	(小提琴)						
苏诗丁						
王瀚宇						
王洁璐	1996/7/31	上海音乐学院 (本硕)	音乐剧	上海		
王竞琦	2001/8/22	四川音乐学院		山东日照		
王俊迪						
王琰婕	(小提琴)						
魏佳源						
吴杭律						
谢文校						
徐丽东	HSU,LI-TONG	8月17日			浙江温州		
徐瑶	1990/9/1	北京舞蹈学院	音乐剧	山西大同	2007级	
徐郑凯伊	2004/8/16	上海视觉艺术学院	音乐剧	东北人	2022级	
胥子含	1997/9/30	复旦大学/Johns Hopkins (硕士)	化学系/材料学 (硕士)	浙江杭州		丫蛋	
阿拉丁	灯老师	1999/9/9	中央戏剧学院	音乐剧	新疆乌鲁木齐	2018级		188
阿云嘎	霞子	1989/10/23	北京舞蹈学院	音乐剧	内蒙古鄂尔多斯	2009级	云次方	
白瀚祥						
白倬铭	J	1996/9/19	天津音乐学院		陕西西安		J娟、J彬	
蔡淇	cjcm	2000/2/10	上海音乐学院	音乐剧		娟心蔡	
曹珺						
陈诗	1995/9/6	上海外国语大学		浙江金华		
陈志	导	1989/12/13	西北大学/中央戏剧学院 (硕士)	对外汉语/编导 (硕士)	吉林		闪导	
戴建新	(贝斯)						
邓欣锐			中央戏剧学院	音乐剧		2017级	中戏17	
丁辉						
翟李朔天	1992/7/1	上海戏剧学院	音乐剧		2012级	上戏12 605	
翟松	1982/12/7					
翟艺						
方书剑	1998/8/5	上海音乐学院	音乐剧	浙江义乌	2016级		
范宇澄						
高杨	1996/7/15	维也纳普莱纳学院	歌剧专业	新疆博乐		权超羊	
高雨晨	1996/8/13	上海音乐学院	音乐剧			弯顶第一初恋，彬高叶	
龚子祺	1997/1/4	上海音乐学院	音乐剧	浙江台州	2015级	上音409	
管重昊						
郭虹旭	香	1995/2/28	南京艺术学院		河北石家庄		香娟	
郭佳诺						
郭嘉轩	花	1998/11/17	上海戏剧学院		山西阳泉	2017级	上戏17	
郭亢	1993/7/29	上海音乐学院	音乐剧	福建福州			
顾易	gyg	1997/2/17	上海音乐学院	音乐剧	上海	2015级	上音409	
何亮辰	豆豆	1992/3/4					176
何铭海						
何岳城						
黄浦申	1996/11/4	上海视觉艺术学院		云南昆明		
黄圣淇						
黄雪煌	恐龙大王	2001/1/31	中国传媒大学南广学院	表演系	广东汕头	2019级	谭黄	
黄梓洋			星海音乐学院	音乐剧			
花子翁	(萨克斯)						
霍泽安	2002/3/4	上海戏剧学院	音乐剧	江苏淮安	2019级		
胡超政	1993/12/4	上海音乐学院 (博士)	音乐剧声乐方向			2013级/2025级博士	上音13 213	
胡迪	1994/6/14						
姜均						
姜崃	1999/10/14	中央戏剧学院	音乐剧	山东青岛	2017级	中戏17、闪嵘、妹嵘	
金圣权	1993/9/7						
纪晓坤	1998/1/24	北京舞蹈学院	音乐剧	山东青岛	2016级	纪汤	
琚茂林	2001/5/18	中央戏剧学院	音乐剧		2020级		
蓝浩	1999/10/9	西安音乐学院/上海音乐学院 (硕士)	流行演唱专业/音乐剧 (硕士)	山东青岛	2021级 (硕士)		
劳其森	73/7Forest	2000/4/24	星海音乐学院 (研究生)	流行演唱	广东湛江	2024级		
梁景皓			星海音乐学院	声乐歌剧	2017级		枫森、景其	
梁育默	1992/10/24	大连艺术学院		辽宁大连		
廖城志			四川音乐学院	音乐剧		2021级		
廖城志						
林大钦	小面	1994/7/12	河北传媒学院	表演系			饼面	
林志明			星海音乐学院					
林子皓	2004/7/15	北京舞蹈学院	音乐剧	浙江温州	2022级		
刘彬濠	1998/5/14	星海音乐学院	声乐歌剧	广东广州	2016级		181
刘瀚聪	1997/3/20	上海音乐学院					
刘令飞	1985/11/15	上海音乐学院	音乐剧	上海			180
刘岩	1972/2/11	吉林艺术学院	古典舞	吉林			180
刘钊						
刘朱烨	刘主页	2002/9/4	北京舞蹈学院	音乐剧			烨奕	
刘子赫	1999/5/11	上海视觉艺术学院			2019级		
李存贤	1999/7/21	中央戏剧学院	音乐剧	江苏徐州	2017级	中戏17	
李珏	jj	1993/8/30	上海戏剧学院	播音与主持	浙江温州	2012级		175
李磊	szyl	1992/6/6	四川音乐学院	音乐剧			330	
李秋盟	1991/9/8	上海音乐学院	音乐剧	辽宁大连		
李锐涵			上海音乐学院	音乐剧		2013级	上音13 213	
李苏霖	1995/11/13	浙江传媒学院	音乐剧舞蹈编导		2014级	祝苏	
李炜鹏	1984/3/6	上海音乐学院	音乐剧	江苏镇江	2003级		
李政绪	2000/11/18	沈阳音乐学院	音乐剧	辽宁营口	2018级		
卢翰林	狮	2003/2/11	浙江音乐学院	音乐剧	浙江杭州	2021级	浙音211，卢赵彪，卢叶	179.5
毛二	mkmr	1999/2/17	中央戏剧学院 (本硕)	音乐剧	湖南湘西	2017级	中戏17	177
冒海飞	企鹅	1987/11/9	南京艺术学院	音乐剧	江苏南通	2005级	璎	175
马海生						
南枫	1991/10/6	美国西北大学、耶鲁大学双硕士	歌剧表演			
倪晔	1983/7/17						
浦弘斐	2002/11/3	中央戏剧学院	音乐剧	辽宁大连	2021级	中戏21	182
钱蒙楠	2000/11/11	上海视觉艺术学院	音乐剧与教育		2019级	siva6009	
"""

def is_date(cell):
    cell = cell.strip()
    if re.match(r'\d{4}/\d{1,2}/\d{1,2}$', cell):
        return True
    if re.match(r'\d{4}年\d{1,2}月\d{1,2}日$', cell):
        return True
    if re.match(r'\d{1,2}月\d{1,2}日$', cell):
        return True
    if re.match(r'\d{4}$', cell):
        return True
    return False

def is_height(cell):
    cell = cell.strip()
    return re.match(r'^1[5-9]\d(\.\d)?$', cell) is not None

def parse_line(line):
    line = line.strip()
    if not line or line.startswith("姓名"):
        return None
    parts = line.split("\t")
    if len(parts) < 1:
        return None
    # normalize: if parts[1] looks like a birth_date (not a nickname), shift by inserting empty nickname
    if len(parts) > 1 and is_date(parts[1]) and not parts[1].strip() == "":
        parts.insert(1, "")
    # detect height vs group_cp vs enrollment misalignment by pattern
    # scan from end: if last element matches height pattern, extract it
    height = None
    group_cp = None
    enrollment = None
    tail = list(parts)
    if tail and is_height(tail[-1]):
        height = tail.pop().strip()
    # check second to last: could be group_cp
    if tail and tail[-1].strip() and not tail[-1].strip().startswith("20") and not "级" in tail[-1]:
        group_cp = tail.pop().strip()
    else:
        # find enrollment (contains 级 or year range)
        for i in range(len(tail) - 1, 3, -1):
            if "级" in tail[i] or "年" in tail[i] or re.match(r'^(20|19)\d{2}', tail[i]):
                enrollment = tail[i].strip()
                # check if there's a group_cp between
                if i > 0 and tail[i-1].strip() and not "级" in tail[i-1] and not "年" in tail[i-1]:
                    group_cp = tail[i-1].strip()
                break

    rec = {
        "name": parts[0].strip(),
        "nickname": parts[1].strip() if len(parts) > 1 and parts[1].strip() else None,
        "birth_date": parts[2].strip() if len(parts) > 2 and parts[2].strip() else None,
        "school": parts[3].strip() if len(parts) > 3 and parts[3].strip() else None,
        "major": parts[4].strip() if len(parts) > 4 and parts[4].strip() else None,
        "hometown": parts[5].strip() if len(parts) > 5 and parts[5].strip() else None,
        "enrollment": enrollment or (parts[6].strip() if len(parts) > 6 and parts[6].strip() else None),
        "group_cp": group_cp or (parts[7].strip() if len(parts) > 7 and parts[7].strip() and parts[7].strip() != "团体" else None),
        "height": height or (parts[8].strip() if len(parts) > 8 and parts[8].strip() else None),
    }
    # skip instrument-only entries
    if rec.get("name", "").endswith(("贝斯)", "萨克斯)", "小提琴)", "钢琴)")):
        return None
    return rec

records = [parse_line(l) for l in raw.strip().split("\n") if parse_line(l)]
# dedupe by name (keep last occurrence with most data)
seen = {}
for r in records:
    if seen.get(r["name"]) is not None:
        old = seen[r["name"]]
        # merge: keep non-None values
        for k in r:
            if r[k] and not old.get(k):
                old[k] = r[k]
    else:
        seen[r["name"]] = {k: v for k, v in r.items()}
records = list(seen.values())

conn = sqlite3.connect(DB)
cur = conn.cursor()

# Ensure extra columns exist on artists
for col, ctype in [
    ("nickname", "TEXT"), ("birth_date", "TEXT"), ("hometown", "TEXT"),
    ("enrollment_year", "TEXT"), ("school", "TEXT"), ("height", "TEXT"),
]:
    try:
        cur.execute(f"ALTER TABLE artists ADD COLUMN {col} {ctype}")
    except sqlite3.OperationalError:
        pass

# Build name->id lookup
cur.execute("SELECT id, name FROM artists")
id_by_name = {}
name_set = set()
for aid, aname in cur.fetchall():
    name_set.add(aname)
    if aname not in id_by_name:
        id_by_name[aname] = []
    id_by_name[aname].append(aid)

# Match and update
results = {"matched": [], "unmatched": [], "multiple": [], "updated": 0}
for r in records:
    nm = r["name"]
    if nm in id_by_name:
        ids = id_by_name[nm]
        if len(ids) == 1:
            results["matched"].append((nm, ids[0]))
        else:
            results["multiple"].append((nm, ids))
            continue
    else:
        # fuzzy: try with/without parenthetical note, or partial
        found = None
        for aname, a_ids in id_by_name.items():
            if aname in nm or nm in aname:
                if len(a_ids) == 1:
                    found = a_ids[0]
                    break
        if found:
            results["matched"].append((nm, found))
            r["_fuzzy"] = True
        else:
            results["unmatched"].append(nm)
            continue

    aid = ids[0] if len(ids) == 1 else (found or None)
    if aid is None:
        continue

    updates = []
    if r.get("nickname"):
        updates.append(("nickname", r["nickname"]))
    if r.get("birth_date"):
        updates.append(("birth_date", r["birth_date"]))
    if r.get("hometown"):
        updates.append(("hometown", r["hometown"]))
    if r.get("enrollment"):
        updates.append(("enrollment_year", r["enrollment"]))
    if r.get("school") and r["school"] not in ("(贝斯)", "(萨克斯)", "(小提琴)", "(钢琴)"):
        updates.append(("school", r["school"]))
    if r.get("height"):
        updates.append(("height", r["height"]))

    for col, val in updates:
        cur.execute(f"UPDATE artists SET {col}=? WHERE id=?", (val, aid))
        results["updated"] += 1

conn.commit()

print("== NAME MATCHING ==")
print("matched:", len(results["matched"]), results["matched"])
print("unmatched:", results["unmatched"])
print("multiple:", results["multiple"])
print("total updates:", results["updated"])

# -- GROUP/CP RELATIONS --
# Add relation types for group and CP
group_types = [
    ("cp", "荧幕CP/搭档", 1, "表演搭档、CP关系"),
    ("dorm", "同寝", 1, "同一宿舍/室友"),
    ("cohort", "同届同学", 1, "同一学校、同一年级"),
    ("band", "乐队/组合", 1, "乐队或音乐组合成员"),
    ("group", "团体成员", 0, "同一团体/厂牌/剧团"),
]
for code, name, builtin, desc in group_types:
    cur.execute("INSERT OR IGNORE INTO relation_types (code,name,is_builtin,description) VALUES (?,?,?,?)",
                (code, name, builtin, desc))

conn.commit()

# Parse group/CP relations from the data
# These are semi-structured: comma-separated group names/abbreviations
# We'll record them as relations for later manual review
group_records = []
for r in records:
    gc = r.get("group_cp")
    if not gc:
        continue
    nm = r["name"]
    aid_matches = id_by_name.get(nm)
    if not aid_matches or len(aid_matches) > 1:
        continue
    aid = aid_matches[0]
    for g in re.split(r'[、，,]', gc):
        g = g.strip()
        if not g:
            continue
        group_records.append({"name": nm, "artist_id": aid, "group_tag": g})

print("\n== GROUP/CP TAGS ==")
for gr in group_records:
    print(f"  {gr['name']} -> {gr['group_tag']}")

# Save group tags for manual review/mapping
import json
with open(os.path.join(BASE, "data", "group_cp_tags.json"), "w", encoding="utf-8") as f:
    json.dump(group_records, f, ensure_ascii=False, indent=1)
conn.close()
print("\nSaved group_cp_tags.json")
