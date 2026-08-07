"""Export SQLite data to a static JS file for the front-end MVP.

Output: web/data.js  (window.MUSIC_GRAPH = {...})
The page loads it via <script src>, so it works by double-clicking
index.html without a server or network.

Data included:
- actors: all artists (id+name), plus profile fields when present
- relations: approved relations with Chinese type name + detail
- coWork: top N co-work partners per actor (for "expand" interactions)
"""
import json
import sqlite3
from collections import defaultdict
from pathlib import Path

BASE = Path(__file__).resolve().parent  # 脚本所在目录 = 项目根
DB = BASE / "music_graph.db"
OUT = BASE / "web" / "data.js"

TOP_COWORK = 12       # 每个演员导出最多的共演对数
MIN_COWORK = 5        # 共演场次下限（过滤噪音）


def main():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # --- actors ---
    actors = {}
    rows = cur.execute("""
        SELECT id, name, nickname, birth_date, major, school, hometown,
               enrollment_year, height, note, is_actor
        FROM artists
    """).fetchall()
    for r in rows:
        a = {"id": r["id"], "name": r["name"]}
        for k in ("nickname", "birth_date", "major", "school", "hometown",
                  "enrollment_year", "height", "note"):
            if r[k] not in (None, ""):
                a[k] = str(r[k])
        actors[r["id"]] = a

    # --- relation types ---
    types = {}
    for r in cur.execute("SELECT id, code, name FROM relation_types"):
        types[r["id"]] = {"code": r["code"], "name": r["name"]}

    # --- relations ---
    relations = []
    rows = cur.execute("""
        SELECT type_id, actor_a, actor_b, detail, status
        FROM relations WHERE status = 'approved'
    """).fetchall()
    for r in rows:
        t = types.get(r["type_id"], {})
        relations.append({
            "type": t.get("code", str(r["type_id"])),
            "typeName": t.get("name", ""),
            "a": r["actor_a"],
            "b": r["actor_b"],
            "detail": r["detail"] or "",
        })

    # --- 参演剧目 + 角色（actor_roles + roles） ---
    musicals = {}
    for r in cur.execute("SELECT id, name FROM musicals"):
        musicals[r["id"]] = r["name"]
    roles = {}
    for r in cur.execute("SELECT id, musical_id, name FROM roles"):
        roles[r["id"]] = {"musical_id": r["musical_id"], "name": r["name"]}
    # actor_musicals: artist_id -> {musical_name: [role_name, ...]}
    actor_musicals = {}
    for r in cur.execute("SELECT artist_id, musical_id, role_id FROM actor_roles"):
        m = musicals.get(r["musical_id"])
        if m is None:
            continue
        d = actor_musicals.setdefault(r["artist_id"], {})
        d.setdefault(m, [])
        role = roles.get(r["role_id"])
        if role and role["name"] not in d[m]:
            d[m].append(role["name"])

    # --- 作品与演员表（musicals 视图，成员带角色） ---
    musical_cast = {}
    for r in cur.execute("SELECT id, name FROM musicals"):
        musical_cast[r["id"]] = {"name": r["name"], "cast": [], "roles": {}}
    for r in cur.execute("SELECT artist_id, musical_id, role_id FROM actor_roles"):
        if r["musical_id"] not in musical_cast:
            continue
        mc = musical_cast[r["musical_id"]]
        if r["artist_id"] not in mc["cast"]:
            mc["cast"].append(r["artist_id"])
        role = roles.get(r["role_id"])
        if role:
            mc["roles"].setdefault(r["artist_id"], [])
            if role["name"] not in mc["roles"][r["artist_id"]]:
                mc["roles"][r["artist_id"]].append(role["name"])

    # --- 团体（groups + members） ---
    group_list = []
    for r in cur.execute("""
        SELECT g.id, g.name, g.type, gm.artist_id
        FROM groups g LEFT JOIN group_members gm ON g.id = gm.group_id
        ORDER BY g.id
    """):
        gid, gname, gtype, mid = r
        g = None
        for existing in group_list:
            if existing["id"] == gid:
                g = existing
                break
        if g is None:
            g = {"id": gid, "name": gname, "type": gtype, "members": []}
            group_list.append(g)
        if mid is not None:
            g["members"].append(mid)

    # --- co-work top N per actor ---
    rows = cur.execute("""
        SELECT actor_a, actor_b, co_show_count FROM co_work_edges
        WHERE co_show_count >= ?
        ORDER BY co_show_count DESC
    """, (MIN_COWORK,)).fetchall()
    by_actor = defaultdict(list)
    for r in rows:
        by_actor[r["actor_a"]].append((r["actor_b"], r["co_show_count"]))
        by_actor[r["actor_b"]].append((r["actor_a"], r["co_show_count"]))
    co_work = []
    seen = set()
    for aid, lst in by_actor.items():
        lst.sort(key=lambda x: -x[1])
        for bid, cnt in lst[:TOP_COWORK]:
            key = tuple(sorted((aid, bid)))
            if key in seen:
                continue
            seen.add(key)
            co_work.append({"a": aid, "b": bid, "count": cnt})
    co_work.sort(key=lambda x: -x["count"])

    data = {
        "generatedAt": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "counts": {
            "actors": len(actors),
            "relations": len(relations),
            "coWork": len(co_work),
        },
        "actors": actors,
        "relations": relations,
        "coWork": co_work,
        "actorMusicals": actor_musicals,
        "musicals": musical_cast,
        "groups": group_list,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    js = "// 由 export_graph.py 自动生成，请勿手改\nwindow.MUSIC_GRAPH = " +          json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    OUT.write_text(js, encoding="utf-8")
    conn.close()
    print("已导出:", OUT)
    print("节点(演员):", len(actors), "| 关系边:", len(relations), "| 共演边:", len(co_work), "| 有参演记录:", len(actor_musicals), "| 团体:", len(group_list))
    print("文件大小: %.1f KB" % (OUT.stat().st_size / 1024))


if __name__ == "__main__":
    main()
