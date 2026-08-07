import sqlite3
from collections import defaultdict


def recompute_co_work_edges(conn):
    """Rebuild co_work_edges from current shows/show_casts. Call after data changes."""
    cur = conn.cursor()
    cur.execute("DELETE FROM co_work_edges")
    conn.commit()

    show_casts = defaultdict(set)
    for row in cur.execute("SELECT show_id, artist_id FROM show_casts"):
        show_casts[row[0]].add(row[1])

    cur.execute("SELECT id, date, musical FROM shows")
    id_info = {}
    for sid, date, musical in cur.fetchall():
        id_info[sid] = (date, musical)

    pair_show = defaultdict(int)
    pair_musical = defaultdict(int)
    pair_first = {}
    pair_last = {}
    musical_actors = defaultdict(set)

    for sid, cast in show_casts.items():
        if len(cast) < 2:
            continue
        cast = sorted(cast)
        date, musical = id_info.get(sid, (None, None))
        for i in range(len(cast)):
            for j in range(i + 1, len(cast)):
                a, b = cast[i], cast[j]
                key = (a, b)
                pair_show[key] += 1
                if key not in pair_first or date < pair_first[key]:
                    pair_first[key] = date
                if key not in pair_last or date > pair_last[key]:
                    pair_last[key] = date
        if musical is not None:
            musical_actors[musical].update(cast)

    for musical, actors in musical_actors.items():
        actors = sorted(actors)
        for i in range(len(actors)):
            for j in range(i + 1, len(actors)):
                key = (actors[i], actors[j])
                pair_musical[key] += 1

    batch = [
        (a, b, n, pair_musical.get((a, b), 0), pair_first.get((a, b)), pair_last.get((a, b)))
        for (a, b), n in pair_show.items()
    ]
    cur.executemany(
        "INSERT OR REPLACE INTO co_work_edges (actor_a,actor_b,co_show_count,co_musical_count,first_co_date,last_co_date) VALUES (?,?,?,?,?,?)",
        batch,
    )
    conn.commit()
    return len(batch)
