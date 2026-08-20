"""Incremental sync of music_graph.db with the live y.saoju.net API.

- Base tables (artists / musicals / roles / actor_roles) are merged incrementally.
  Manually added rows (自建演员/剧目，如《坏家伙》) are preserved and never deleted.
- Show schedule synced day-by-day via /api/search_day/?date=YYYY-MM-DD.
  Only dates not already in the DB are fetched, so reruns are cheap.
- After syncing, co_work_edges are recomputed.

Usage: python sync.py
"""
import datetime as dt
import json
import os
import sqlite3
import sys
import time

import requests

import graph_utils

from pathlib import Path
BASE = Path(__file__).resolve().parent  # 脚本所在目录 = 项目根
DB = BASE / "music_graph.db"
API = "https://y.saoju.net/yyj/api"
HORIZON_DAYS = 420      # how far ahead to probe for new dates
EMPTY_STREAK_LIMIT = 45 # stop probing after this many consecutive empty days
FUTURE_DAYS = 700       # how far ahead search_day will be probed on the very first run

SESSION = requests.Session()
SESSION.headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"


def get_json(path):
    r = SESSION.get(API + path, timeout=60)
    r.raise_for_status()
    return r.json()


def upsert_base_tables(cur, conn):
    """Merge base tables from the official API, preserving manually added data.

    Manual rows (self-created actors/musicals like 《坏家伙》) are not present in
    the y.saoju API and must survive every sync. API rows are upserted by id;
    fully-API actor_roles are refreshed, while rows touching a manual artist or
    manual musical are kept.
    """
    artists = get_json("/artist/")
    musicals = get_json("/musical/")
    roles = get_json("/role/")
    mc = get_json("/musicalcast/")

    api_artist_ids = []
    for a in artists:
        aid = a["pk"]
        api_artist_ids.append(aid)
        cur.execute(
            "INSERT INTO artists (id,name,note,is_actor) VALUES (?,?,?,1) "
            "ON CONFLICT(id) DO UPDATE SET name=excluded.name, note=excluded.note, is_actor=1",
            (aid, a["fields"]["name"], a["fields"].get("note")),
        )

    api_musical_ids = []
    for m in musicals:
        mid = m["pk"]
        api_musical_ids.append(mid)
        cur.execute(
            "INSERT INTO musicals (id,name,is_original,progress,premiere_date,info) VALUES (?,?,?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET name=excluded.name, is_original=excluded.is_original, "
            "progress=excluded.progress, premiere_date=excluded.premiere_date, info=excluded.info",
            (mid, m["fields"]["name"], 1 if m["fields"]["is_original"] else 0,
             m["fields"]["progress"], m["fields"]["premiere_date"] or None, m["fields"]["info"] or None),
        )

    for r in roles:
        cur.execute(
            "INSERT INTO roles (id,musical_id,name) VALUES (?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET musical_id=excluded.musical_id, name=excluded.name",
            (r["pk"], r["fields"]["musical"], r["fields"]["name"]),
        )

    # Refresh only fully-API actor_roles; keep rows that involve a manual artist
    # or a manual musical (e.g. 《坏家伙》).
    cur.execute("CREATE TEMP TABLE IF NOT EXISTS _api_artist(id INTEGER PRIMARY KEY)")
    cur.executemany("INSERT OR IGNORE INTO _api_artist(id) VALUES (?)", [(i,) for i in api_artist_ids])
    cur.execute("CREATE TEMP TABLE IF NOT EXISTS _api_musical(id INTEGER PRIMARY KEY)")
    cur.executemany("INSERT OR IGNORE INTO _api_musical(id) VALUES (?)", [(i,) for i in api_musical_ids])
    cur.execute(
        "DELETE FROM actor_roles WHERE artist_id IN (SELECT id FROM _api_artist) "
        "AND musical_id IN (SELECT id FROM _api_musical)"
    )
    cur.execute("DROP TABLE _api_artist")
    cur.execute("DROP TABLE _api_musical")

    role2musical = {r["pk"]: r["fields"]["musical"] for r in roles}
    cur.executemany(
        "INSERT INTO actor_roles (artist_id,musical_id,role_id) VALUES (?,?,?)",
        [(c["fields"]["artist"], role2musical[c["fields"]["role"]], c["fields"]["role"]) for c in mc],
    )
    conn.commit()
    return {"artists": len(artists), "musicals": len(musicals), "actor_roles": len(mc)}


def sync_shows(cur, conn):
    """Pull day-by-day schedule for dates not already in DB."""
    existing = {r[0] for r in cur.execute("SELECT DISTINCT date FROM shows")}

    today = dt.date.today()
    # First run probe window vs subsequent incremental window
    # We always probe from (today - 2) forward so same-day edits are caught.
    start = today - dt.timedelta(days=2)
    # find furthest existing date to know if we need the long window
    max_existing = cur.execute("SELECT MAX(date) FROM shows").fetchone()[0]

    name2ids = {}
    for aid, name in cur.execute("SELECT id,name FROM artists"):
        name2ids.setdefault(name, []).append(aid)

    new_dates = 0
    empty_streak = 0
    date = start
    end = today + dt.timedelta(days=HORIZON_DAYS)

    while date <= end:
        ds = date.isoformat()
        if ds in existing:
            date += dt.timedelta(days=1)
            empty_streak = 0
            continue
        try:
            data = get_json("/search_day/?date=" + ds)
        except Exception as e:
            print(f"  fetch error {ds}: {e}", flush=True)
            time.sleep(2)
            date += dt.timedelta(days=1)
            continue
        shows = data.get("show_list", [])
        if not shows:
            empty_streak += 1
            if empty_streak >= EMPTY_STREAK_LIMIT:
                break
        else:
            empty_streak = 0
            for s in shows:
                key = (ds, s.get("time", ""), s.get("city", ""), s.get("musical", ""), s.get("theatre", ""))
                cur.execute(
                    "INSERT OR IGNORE INTO shows (date,time,city,musical,theatre) VALUES (?,?,?,?,?)", key)
                cur.execute(
                    "SELECT id FROM shows WHERE date=? AND time=? AND city=? AND musical=? AND theatre=?", key)
                sid = cur.fetchone()[0]
                for c in s.get("cast", []):
                    artist_name = c.get("artist")
                    ids = name2ids.get(artist_name)
                    aid = ids[0] if ids and len(ids) == 1 else None
                    if aid is None and ids:
                        # ambiguous same-name artist; record for manual resolution
                        cur.execute(
                            "INSERT OR IGNORE INTO unresolved_cast (date,musical,artist_name,candidate_ids) VALUES (?,?,?,?)",
                            (ds, s.get("musical"), artist_name, ",".join(map(str, ids))))
                    cur.execute(
                        "INSERT OR IGNORE INTO show_casts (show_id, artist_id, role) VALUES (?,?,?)",
                        (sid, aid, c.get("role", "")))
                    if aid is not None:
                        name2ids.setdefault(artist_name, [aid])
            new_dates += 1
            existing.add(ds)
        date += dt.timedelta(days=1)
        time.sleep(0.25)
    conn.commit()
    return new_dates


def main():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    cur.execute("""CREATE TABLE IF NOT EXISTS sync_log (
        id INTEGER PRIMARY KEY,
        run_at TEXT,
        new_dates INTEGER,
        artists INTEGER,
        musicals INTEGER,
        actor_roles INTEGER,
        edges INTEGER)""")
    cur.execute("""CREATE TABLE IF NOT EXISTS unresolved_cast (
        date TEXT, musical TEXT, artist_name TEXT, candidate_ids TEXT)""")

    print("== syncing base tables ==", flush=True)
    base = upsert_base_tables(cur, conn)

    print("== syncing show schedule ==", flush=True)
    new_dates = sync_shows(cur, conn)

    print("== recomputing co-work edges ==", flush=True)
    n_edges = graph_utils.recompute_co_work_edges(conn)

    cur.execute(
        "INSERT INTO sync_log (run_at,new_dates,artists,musicals,actor_roles,edges) VALUES (?,?,?,?,?,?)",
        (dt.datetime.now().isoformat(), new_dates, base["artists"], base["musicals"], base["actor_roles"], n_edges),
    )
    conn.commit()
    cur.execute("SELECT COUNT(*) FROM shows")
    total_shows = cur.fetchone()[0]
    conn.close()
    print(f"done. base={base} new_dates={new_dates} edges={n_edges} total_shows={total_shows}", flush=True)


if __name__ == "__main__":
    main()
