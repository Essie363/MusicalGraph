"""Export a small, real-data fixture for the offline rating demo.

The demo deliberately includes one reviewable case instead of shipping the full
schedule database to browsers: Xu Junshuo's 62 Fan Letter performances, whose
role was filled by the unique-role inference pass.
"""

from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from pathlib import Path


BASE = Path(__file__).resolve().parent
DB_PATH = BASE / "music_graph.db"
OUT_PATH = BASE / "web" / "rating_demo_data.js"
ACTOR_NAME = "徐均朔"
MUSICAL_NAME = "粉丝来信"
ROLE_NAME = "郑微岚"


def main() -> None:
    with sqlite3.connect(DB_PATH) as connection:
        actor_id, musical_id, role_id = connection.execute(
            """
            SELECT a.id, m.id, r.id
            FROM artists a
            JOIN actor_roles ar ON ar.artist_id = a.id
            JOIN musicals m ON m.id = ar.musical_id
            JOIN roles r ON r.id = ar.role_id
            WHERE a.name = ? AND m.name = ? AND r.name = ?
            """,
            (ACTOR_NAME, MUSICAL_NAME, ROLE_NAME),
        ).fetchone()
        performances: dict[int, dict] = {}
        rows = connection.execute(
            """
            SELECT s.id, s.date, s.time, s.city, s.theatre,
                   a.id, a.name, COALESCE(NULLIF(TRIM(sc.role), ''), '角色待补充')
            FROM shows s
            JOIN show_casts target ON target.show_id = s.id
            JOIN artists target_actor ON target_actor.id = target.artist_id
            JOIN show_casts sc ON sc.show_id = s.id
            JOIN artists a ON a.id = sc.artist_id
            WHERE target_actor.name = ? AND s.musical = ?
            ORDER BY s.date, s.time, a.name
            """,
            (ACTOR_NAME, MUSICAL_NAME),
        )
        for show_id, date, time, city, theatre, cast_actor_id, cast_actor_name, cast_role in rows:
            item = performances.setdefault(show_id, {
                "id": show_id, "date": date, "time": time, "city": city,
                "theatre": theatre, "role_confirmed": True, "cast": [],
            })
            item["cast"].append({
                "actor_id": cast_actor_id, "actor_name": cast_actor_name, "role_name": cast_role,
            })

    rows = list(performances.values())
    payload = {
        "generatedAt": "local SQLite",
        "performances": {
            f"{actor_id}|{musical_id}|{role_id}": rows,
            f"{actor_id}|{musical_id}|{ROLE_NAME}": rows,
        },
    }
    OUT_PATH.write_text(
        "window.MG_RATING_DEMO_PERFORMANCES = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"Exported {len(performances)} real demo performances to {OUT_PATH}")


if __name__ == "__main__":
    main()
