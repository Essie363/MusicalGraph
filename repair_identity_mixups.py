"""Apply only confirmed artist identity repairs to the local SQLite catalog.

The input file is deliberately explicit.  It is for historical source-ID reuse
repairs, not a general-purpose data cleanup tool.  Run without --apply first
to review the exact changes.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DB = ROOT / "music_graph.db"
CORRECTIONS = ROOT / "data" / "identity_corrections.json"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="write confirmed repairs")
    args = parser.parse_args()
    corrections = json.loads(CORRECTIONS.read_text(encoding="utf-8"))["corrections"]

    with sqlite3.connect(DB) as conn:
        cur = conn.cursor()
        for item in corrections:
            artist_id = item["artist_id"]
            current = cur.execute(
                "SELECT id,name,nickname,birth_date,note,is_actor FROM artists WHERE id=?",
                (artist_id,),
            ).fetchone()
            if not current:
                raise RuntimeError(f"artist {artist_id} does not exist")
            role_count = cur.execute(
                "SELECT COUNT(*) FROM actor_roles WHERE artist_id=?", (artist_id,)
            ).fetchone()[0]
            cast_count = cur.execute(
                "SELECT COUNT(*) FROM show_casts WHERE artist_id=?", (artist_id,)
            ).fetchone()[0]
            print(
                f"{artist_id}: {current[1]!r} -> {item['name']!r}; "
                f"roles={role_count}, show_casts_to_unlink={cast_count}"
            )
            if not args.apply:
                continue

            cur.execute(
                """UPDATE artists
                   SET name=?, nickname=?, birth_date=?, note=?, is_actor=?
                   WHERE id=?""",
                (
                    item["name"], item["nickname"], item["birth_date"],
                    item["note"], 1 if item["is_actor"] else 0, artist_id,
                ),
            )
            if item.get("remove_actor_roles"):
                cur.execute("DELETE FROM actor_roles WHERE artist_id=?", (artist_id,))
            if item.get("unlink_show_casts"):
                # Keep source schedule rows, but stop assigning them to the wrong person.
                cur.execute("UPDATE show_casts SET artist_id=NULL WHERE artist_id=?", (artist_id,))
            for group_id in item.get("restore_group_memberships", []):
                cur.execute(
                    "INSERT OR IGNORE INTO group_members(group_id,artist_id) VALUES (?,?)",
                    (group_id, artist_id),
                )
        if not args.apply:
            print("Dry run only. Re-run with --apply after database backup.")


if __name__ == "__main__":
    main()
