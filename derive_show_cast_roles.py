"""Fill blank show_cast roles only when an actor has one canonical role in that musical.

The source schedule API normally knows who performs, but not their role for that
particular show. This deterministic pass is deliberately conservative: actors
with two or more roles in a musical are left blank for manual confirmation.
"""

from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path


DB_PATH = Path(__file__).with_name("music_graph.db")


def candidates(connection: sqlite3.Connection) -> list[tuple[int, str]]:
    return connection.execute(
        """
        SELECT sc.rowid, MIN(r.name) AS role_name
        FROM show_casts sc
        JOIN shows s ON s.id = sc.show_id
        JOIN musicals m ON m.name = s.musical
        JOIN actor_roles ar
          ON ar.artist_id = sc.artist_id AND ar.musical_id = m.id
        JOIN roles r ON r.id = ar.role_id
        WHERE trim(COALESCE(sc.role, '')) = ''
        GROUP BY sc.rowid
        HAVING COUNT(DISTINCT ar.role_id) = 1
        """
    ).fetchall()


def fill_unique_roles(connection: sqlite3.Connection) -> int:
    rows = candidates(connection)
    connection.executemany(
        "UPDATE show_casts SET role = ? WHERE rowid = ? AND trim(COALESCE(role, '')) = ''",
        [(role_name, rowid) for rowid, role_name in rows],
    )
    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Derive unambiguous show cast roles.")
    parser.add_argument("--dry-run", action="store_true", help="Report candidates without writing.")
    args = parser.parse_args()

    with sqlite3.connect(DB_PATH) as connection:
        rows = candidates(connection)
        print(f"Unambiguous blank show-cast roles: {len(rows)}")
        if args.dry_run:
            return
        connection.executemany(
            "UPDATE show_casts SET role = ? WHERE rowid = ? AND trim(COALESCE(role, '')) = ''",
            [(role_name, rowid) for rowid, role_name in rows],
        )
        print(f"Filled show-cast roles: {len(rows)}")


if __name__ == "__main__":
    main()
