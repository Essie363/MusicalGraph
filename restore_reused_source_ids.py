"""Restore catalog records whose upstream artist IDs were reused.

For every candidate in data/identity_change_audit.json, the script takes the
artist row, role links, and cast links from the database immediately before the
bad sync commit.  Current source rows are not deleted: cast rows that cannot be
trusted are retained with artist_id=NULL for later matching.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
from collections import defaultdict
from pathlib import Path

import graph_utils


ROOT = Path(__file__).resolve().parent
DB = ROOT / "music_graph.db"
AUDIT = ROOT / "data" / "identity_change_audit.json"
RESULT = ROOT / "data" / "identity_recovery_result.json"


def git_bytes(*args: str) -> bytes:
    return subprocess.check_output(["git", *args], cwd=ROOT)


def load_legacy_database(change_commit: str) -> tuple[sqlite3.Connection, Path]:
    full_commit = git_bytes("rev-parse", change_commit).decode().strip()
    raw = git_bytes("show", f"{full_commit}^:music_graph.db")
    fd, raw_path = tempfile.mkstemp(prefix="music_graph_identity_baseline_", suffix=".db")
    os.close(fd)
    path = Path(raw_path)
    path.write_bytes(raw)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn, path


def candidate_groups() -> dict[str, list[dict]]:
    changes = json.loads(AUDIT.read_text(encoding="utf-8"))["changes"]
    grouped: dict[str, list[dict]] = defaultdict(list)
    for item in changes:
        grouped[item["commit"]].append(item)
    return grouped


def row_count(cur: sqlite3.Cursor, sql: str, params: tuple) -> int:
    return cur.execute(sql, params).fetchone()[0]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="write the recovery after backing up")
    args = parser.parse_args()
    groups = candidate_groups()
    summary: list[dict] = []

    if args.apply:
        stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        backup = ROOT / f"music_graph_backup_identity_restore_{stamp}_pre.db"
        shutil.copy2(DB, backup)
        print(f"backup: {backup.name}")

    with sqlite3.connect(DB) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        for change_commit, items in groups.items():
            legacy, legacy_path = load_legacy_database(change_commit)
            legacy_cur = legacy.cursor()
            try:
                for item in items:
                    artist_id = int(item["id"])
                    old = legacy_cur.execute(
                        "SELECT * FROM artists WHERE id=?", (artist_id,)
                    ).fetchone()
                    if not old:
                        raise RuntimeError(f"baseline {change_commit} lacks artist {artist_id}")
                    roles_before = row_count(
                        legacy_cur, "SELECT COUNT(*) FROM actor_roles WHERE artist_id=?", (artist_id,)
                    )
                    casts_before = row_count(
                        legacy_cur, "SELECT COUNT(*) FROM show_casts WHERE artist_id=?", (artist_id,)
                    )
                    current_roles = row_count(
                        cur, "SELECT COUNT(*) FROM actor_roles WHERE artist_id=?", (artist_id,)
                    )
                    current_casts = row_count(
                        cur, "SELECT COUNT(*) FROM show_casts WHERE artist_id=?", (artist_id,)
                    )
                    summary.append({
                        "artist_id": artist_id,
                        "restore_name": old["name"],
                        "baseline_commit": change_commit,
                        "baseline_roles": roles_before,
                        "baseline_show_casts": casts_before,
                        "current_roles": current_roles,
                        "current_show_casts": current_casts,
                    })
                    print(
                        f"{artist_id}: {item['current_name']} -> {old['name']} | "
                        f"roles {current_roles}->{roles_before}, casts {current_casts}->{casts_before}"
                    )
                    if not args.apply:
                        continue

                    # Restore every available actor column from the pre-conflict DB.
                    columns = [r[1] for r in cur.execute("PRAGMA table_info(artists)")]
                    old_keys = set(old.keys())
                    columns = [c for c in columns if c != "id" and c in old_keys]
                    cur.execute(
                        "UPDATE artists SET {} WHERE id=?".format(
                            ",".join(f'"{c}"=?' for c in columns)
                        ),
                        tuple(old[c] for c in columns) + (artist_id,),
                    )

                    # Remove post-conflict role links and preserve their show rows as unassigned.
                    cur.execute("DELETE FROM actor_roles WHERE artist_id=?", (artist_id,))
                    cur.execute("UPDATE show_casts SET artist_id=NULL WHERE artist_id=?", (artist_id,))

                    for role in legacy_cur.execute(
                        "SELECT artist_id,musical_id,role_id FROM actor_roles WHERE artist_id=?", (artist_id,)
                    ):
                        exists = cur.execute(
                            """SELECT 1 FROM actor_roles
                               WHERE artist_id=? AND musical_id=? AND role_id=? LIMIT 1""",
                            tuple(role),
                        ).fetchone()
                        if not exists:
                            cur.execute(
                                "INSERT INTO actor_roles(artist_id,musical_id,role_id) VALUES (?,?,?)",
                                tuple(role),
                            )
                    for cast in legacy_cur.execute(
                        "SELECT show_id,artist_id,role FROM show_casts WHERE artist_id=?", (artist_id,)
                    ):
                        show_exists = cur.execute(
                            "SELECT 1 FROM shows WHERE id=?", (cast["show_id"],)
                        ).fetchone()
                        exists = cur.execute(
                            """SELECT 1 FROM show_casts
                               WHERE show_id=? AND artist_id=? AND role=? LIMIT 1""",
                            tuple(cast),
                        ).fetchone()
                        if show_exists and not exists:
                            cur.execute(
                                "INSERT INTO show_casts(show_id,artist_id,role) VALUES (?,?,?)",
                                tuple(cast),
                            )
            finally:
                legacy_cur.close()
                legacy.close()
                legacy_path.unlink(missing_ok=True)

        if args.apply:
            graph_utils.recompute_co_work_edges(conn)
            RESULT.write_text(
                json.dumps({
                    "recovered_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                    "records": summary,
                }, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
    print("Applied." if args.apply else "Dry run only. Re-run with --apply to restore.")


if __name__ == "__main__":
    main()
