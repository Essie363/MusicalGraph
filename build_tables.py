import json
import os
import csv

from pathlib import Path
BASE = Path(__file__).resolve().parent  # 脚本所在目录 = 项目根
RAW_DIR = BASE / "data" / "raw"
OUT = BASE / "data"
API_RAW = BASE / "data" / "api_raw"

artists = json.load(open(API_RAW / "artist_raw.json", encoding="utf-8"))
mc = json.load(open(API_RAW / "musicalcast_raw.json", encoding="utf-8"))
role = json.load(open(API_RAW / "role_raw.json", encoding="utf-8"))
musical = json.load(open(API_RAW / "musical_raw.json", encoding="utf-8"))
staff = json.load(open(API_RAW / "musicalstaff_raw.json", encoding="utf-8"))

artist_name = {a["pk"]: a["fields"]["name"] for a in artists}
artist_note = {a["pk"]: a["fields"].get("note") for a in artists}
musical_name = {m["pk"]: m["fields"]["name"] for m in musical}
role_map = {r["pk"]: r for r in role}

def parse_time(t):
    # "2023-02-03 19:30" or "2023-02-03T..."
    for sep in (" ", "T"):
        if sep in t:
            d, tm = t.split(sep, 1)
            return d, tm[:5]
    return t, ""

# 1. actors.csv : identity + role summary
actor_ids = sorted(set(a["fields"]["artist"] for a in mc))
actors_out = []
for aid in actor_ids:
    roles = []
    for c in mc:
        if c["fields"]["artist"] == aid:
            rid = c["fields"]["role"]
            roles.append(role_map.get(rid, {}).get("fields", {}).get("name", ""))
    actors_out.append({
        "artist_id": aid,
        "name": artist_name.get(aid, ""),
        "note": artist_note.get(aid) or "",
        "role_count": len(roles),
        "roles": " / ".join(roles),
    })

with open(os.path.join(OUT, "artists.csv"), "w", newline="", encoding="utf-8-sig") as f:
    w = csv.DictWriter(f, fieldnames=["artist_id", "name", "note", "role_count", "roles"])
    w.writeheader()
    w.writerows(actors_out)
print("artists.csv:", len(actors_out))

# 2. actor_roles.csv : musical cast mapping (同剧组)
ar = []
seen = set()
for c in mc:
    rid = c["fields"]["role"]
    aid = c["fields"]["artist"]
    mid = role_map.get(rid, {}).get("fields", {}).get("musical")
    key = (aid, mid)
    if key in seen:
        continue
    seen.add(key)
    ar.append({
        "artist_id": aid,
        "name": artist_name.get(aid, ""),
        "musical_id": mid,
        "musical": musical_name.get(mid, ""),
        "role": role_map.get(rid, {}).get("fields", {}).get("name", ""),
    })
with open(os.path.join(OUT, "actor_roles.csv"), "w", newline="", encoding="utf-8-sig") as f:
    w = csv.DictWriter(f, fieldnames=["artist_id", "name", "musical_id", "musical", "role"])
    w.writeheader()
    w.writerows(ar)
print("actor_roles.csv:", len(ar))

# 3. actor_shows.csv : every recorded performance per actor
rows = []
n_files = 0
n_rows = 0
for aid in actor_ids:
    path = os.path.join(RAW_DIR, f"{aid}.csv")
    if not os.path.exists(path):
        continue
    n_files += 1
    with open(path, encoding="utf-8-sig") as f:
        rd = csv.reader(f)
        header = next(rd, None)
        for r in rd:
            if not r or len(r) < 5:
                continue
            date, tm = parse_time(r[0])
            rows.append({
                "artist_id": aid,
                "name": artist_name.get(aid, ""),
                "date": date,
                "time": tm,
                "city": r[1],
                "musical": r[2],
                "role": r[3],
                "theatre": r[4],
            })
            n_rows += 1
rows.sort(key=lambda x: (x["date"], x["time"]))
with open(os.path.join(OUT, "actor_shows.csv"), "w", newline="", encoding="utf-8-sig") as f:
    w = csv.DictWriter(f, fieldnames=["artist_id", "name", "date", "time", "city", "musical", "role", "theatre"])
    w.writeheader()
    w.writerows(rows)
print("actor_shows.csv:", n_rows, "rows from", n_files, "files")

# 4. show_cast.csv : which actors performed together in the same show (同场)
# group by date+musical+theatre+time
groups = {}
for r in rows:
    key = (r["date"], r["time"], r["city"], r["musical"], r["theatre"])
    groups.setdefault(key, set()).add((r["artist_id"], r["name"]))

sc = []
for (date, tm, city, musical_name_, theatre), casts in groups.items():
    cl = sorted(casts, key=lambda x: x[0])
    sc.append({
        "date": date,
        "time": tm,
        "city": city,
        "musical": musical_name_,
        "theatre": theatre,
        "cast_count": len(cl),
        "cast_ids": ";".join(str(x[0]) for x in cl),
        "cast_names": ";".join(x[1] for x in cl),
    })
sc.sort(key=lambda x: (x["date"], x["time"]))
with open(os.path.join(OUT, "show_cast.csv"), "w", newline="", encoding="utf-8-sig") as f:
    w = csv.DictWriter(f, fieldnames=["date", "time", "city", "musical", "theatre", "cast_count", "cast_ids", "cast_names"])
    w.writeheader()
    w.writerows(sc)
print("show_cast.csv:", len(sc))
