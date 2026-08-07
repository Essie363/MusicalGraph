import sqlite3
import csv
import os
import json
from collections import defaultdict

from pathlib import Path
BASE = Path(__file__).resolve().parent  # 脚本所在目录 = 项目根
DATA = BASE / "data"
DB = BASE / "music_graph.db"

conn = sqlite3.connect(DB)
cur = conn.cursor()

cur.executescript("""
PRAGMA journal_mode=OFF;
PRAGMA synchronous=OFF;

CREATE TABLE IF NOT EXISTS relation_types (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_builtin INTEGER DEFAULT 0,
  description TEXT
);

CREATE TABLE IF NOT EXISTS artists (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  note TEXT,
  is_actor INTEGER DEFAULT 1,
  school TEXT
);

CREATE TABLE IF NOT EXISTS musicals (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  is_original INTEGER,
  progress TEXT,
  premiere_date TEXT,
  info TEXT
);

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY,
  musical_id INTEGER,
  name TEXT
);

CREATE TABLE IF NOT EXISTS actor_roles (
  artist_id INTEGER,
  musical_id INTEGER,
  role_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_actor_roles_artist ON actor_roles(artist_id);
CREATE INDEX IF NOT EXISTS idx_actor_roles_musical ON actor_roles(musical_id);

CREATE TABLE IF NOT EXISTS shows (
  id INTEGER PRIMARY KEY,
  date TEXT,
  time TEXT,
  city TEXT,
  musical TEXT,
  theatre TEXT,
  UNIQUE(date, time, city, musical, theatre)
);

CREATE TABLE IF NOT EXISTS show_casts (
  show_id INTEGER,
  artist_id INTEGER,
  role TEXT
);
CREATE INDEX IF NOT EXISTS idx_show_casts_show ON show_casts(show_id);
CREATE INDEX IF NOT EXISTS idx_show_casts_artist ON show_casts(artist_id);

CREATE TABLE IF NOT EXISTS co_work_edges (
  actor_a INTEGER NOT NULL,
  actor_b INTEGER NOT NULL,
  co_show_count INTEGER DEFAULT 0,
  co_musical_count INTEGER DEFAULT 0,
  first_co_date TEXT,
  last_co_date TEXT,
  PRIMARY KEY (actor_a, actor_b)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE,
  nickname TEXT,
  auth_method TEXT,
  role TEXT DEFAULT 'user',
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS relations (
  id INTEGER PRIMARY KEY,
  type_id INTEGER NOT NULL,
  actor_a INTEGER NOT NULL,
  actor_b INTEGER NOT NULL,
  detail TEXT,
  source_type TEXT NOT NULL DEFAULT 'user',
  source_url TEXT,
  evidence TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  confidence REAL,
  submitted_by INTEGER,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_relations_pair ON relations(actor_a, actor_b);
CREATE INDEX IF NOT EXISTS idx_relations_status ON relations(status);

CREATE TABLE IF NOT EXISTS review_logs (
  id INTEGER PRIMARY KEY,
  relation_id INTEGER,
  action TEXT,
  reviewer INTEGER,
  comment TEXT,
  created_at TEXT
);
""")

# reset
for t in ("actor_roles", "shows", "show_casts", "co_work_edges", "artists", "musicals", "roles"):
    cur.execute(f"DELETE FROM {t}")

# artists
with open(os.path.join(DATA, "artists.csv"), encoding="utf-8-sig") as f:
    for r in csv.DictReader(f):
        cur.execute("INSERT OR REPLACE INTO artists (id, name, note) VALUES (?,?,?)",
                    (int(r["artist_id"]), r["name"], r["note"] or None))

# musicals
with open(BASE / "data" / "api_raw" / "musical_raw.json", encoding="utf-8") as f:
    for m in json.load(f):
        fld = m["fields"]
        cur.execute("INSERT OR REPLACE INTO musicals (id, name, is_original, progress, premiere_date, info) VALUES (?,?,?,?,?,?)",
                    (m["pk"], fld["name"], 1 if fld["is_original"] else 0, fld["progress"], fld["premiere_date"] or None, fld["info"] or None))

# roles
with open(BASE / "data" / "api_raw" / "role_raw.json", encoding="utf-8") as f:
    role_rows = json.load(f)
cur.executemany("INSERT OR REPLACE INTO roles (id, musical_id, name) VALUES (?,?,?)",
                [(r["pk"], r["fields"]["musical"], r["fields"]["name"]) for r in role_rows])
role2musical = {r["pk"]: r["fields"]["musical"] for r in role_rows}

# actor_roles
with open(BASE / "data" / "api_raw" / "musicalcast_raw.json", encoding="utf-8") as f:
    mc = json.load(f)
cur.executemany("INSERT INTO actor_roles (artist_id, musical_id, role_id) VALUES (?,?,?)",
                [(c["fields"]["artist"], role2musical[c["fields"]["role"]], c["fields"]["role"]) for c in mc])

# shows + show_casts
with open(os.path.join(DATA, "show_cast.csv"), encoding="utf-8-sig") as f:
    rows = list(csv.DictReader(f))

print("importing shows...", flush=True)
seen = set()
show_rows = []
show_cast_rows = []
for r in rows:
    key = (r["date"], r["time"], r["city"], r["musical"], r["theatre"])
    if key not in seen:
        seen.add(key)
        show_rows.append((r["date"], r["time"], r["city"], r["musical"], r["theatre"]))
cur.executemany("INSERT OR IGNORE INTO shows (date,time,city,musical,theatre) VALUES (?,?,?,?,?)", show_rows)
sid = {s[0]: (s[1], s[2]) for s in cur.execute("SELECT id,date,musical FROM shows")}  # id -> (date, musical)
for r in rows:
    key = (r["date"], r["time"], r["city"], r["musical"], r["theatre"])
    i = sid.get(key)
    if i is None:
        continue
    # need actual show id: key by date/musical is ambiguous; re-query
    pass
conn.commit()
print("shows imported:", len(show_rows), flush=True)

# re-fetch show ids properly (unique key -> id)
cur.execute("SELECT id,date,time,city,musical,theatre FROM shows")
show_info = {}
id_info = {}
for row in cur.fetchall():
    key = (row[1], row[2], row[3], row[4], row[5])
    show_info[key] = row[0]
    id_info[row[0]] = (row[1], row[4])

sc_batch = []
for r in rows:
    key = (r["date"], r["time"], r["city"], r["musical"], r["theatre"])
    sid = show_info.get(key)
    if sid is None or not r["cast_ids"]:
        continue
    for aid in r["cast_ids"].split(";"):
        sc_batch.append((sid, int(aid), ""))
cur.executemany("INSERT INTO show_casts (show_id, artist_id, role) VALUES (?,?,?)", sc_batch)
conn.commit()
print("show_casts imported:", len(sc_batch), flush=True)

# ---- relationship computation (in memory) ----
print("computing co-work edges...", flush=True)
show_casts = defaultdict(set)
for row in cur.execute("SELECT show_id, artist_id FROM show_casts"):
    show_casts[row[0]].add(row[1])

pair_show = defaultdict(int)
pair_musical = defaultdict(int)
pair_first = {}
pair_last = {}

musical_actors = defaultdict(set)
for sid, cast in show_casts.items():
    if len(cast) < 2:
        continue
    cast = sorted(cast)
    date, mus = id_info.get(sid, (None, None))
    for i in range(len(cast)):
        for j in range(i + 1, len(cast)):
            a, b = cast[i], cast[j]
            key = (a, b)
            pair_show[key] += 1
            if key not in pair_first or date < pair_first[key]:
                pair_first[key] = date
            if key not in pair_last or date > pair_last[key]:
                pair_last[key] = date
    if mus is not None:
        musical_actors[mus].update(cast)

print("computing co_musical...", flush=True)
for mus, actors in musical_actors.items():
    actors = sorted(actors)
    for i in range(len(actors)):
        for j in range(i + 1, len(actors)):
            key = (actors[i], actors[j])
            pair_musical[key] += 1

print("writing edges...", flush=True)
edge_batch = []
for (a, b), n in pair_show.items():
    edge_batch.append((a, b, n, pair_musical.get((a, b), 0), pair_first.get((a, b)), pair_last.get((a, b))))
cur.executemany("INSERT OR REPLACE INTO co_work_edges (actor_a,actor_b,co_show_count,co_musical_count,first_co_date,last_co_date) VALUES (?,?,?,?,?,?)", edge_batch)

builtin = [
    ("co_work", "共演", 1, "同一场演出同台 / 同剧组(机器推导)"),
    ("classmate", "同学", 1, "曾在同一学校/专业学习"),
    ("couple", "情侣", 1, "现实中的真实情侣关系（当前暂无数据）"),
    ("cp", "CP", 1, "粉丝组合/CP名"),
    ("spouse", "夫妻", 1, "婚姻关系"),
    ("teacher_student", "师生", 1, "师生关系"),
    ("same_company", "同公司", 1, "同属一家经纪/制作公司"),
    ("friend", "好友", 1, "公开好友关系"),
    ("custom", "自定义", 0, "用户自定义关系"),
]
cur.executemany("INSERT OR IGNORE INTO relation_types (code,name,is_builtin,description) VALUES (?,?,?,?)", builtin)

conn.commit()
for t in ("co_work_edges", "shows", "show_casts"):
    print(t, cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0])
cur.execute("SELECT MAX(co_show_count), AVG(co_show_count) FROM co_work_edges")
print("max/avg co_show_count:", cur.fetchone())
conn.close()
print("done ->", DB)
