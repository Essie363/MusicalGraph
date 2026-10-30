"""Append machine-owned data to Supabase without overwriting reviewed data.

This is the safe GitHub Actions sync path. It adds missing API identities,
actor-role links, schedules, and casts; records ambiguous conflicts; then asks
Supabase to rebuild co-work edges from the merged online schedule data.
"""
import hashlib
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from migrate_supabase import get_rows, load_env, open_retry, to_batches


BASE = Path(__file__).resolve().parent
DB = BASE / "music_graph.db"
SOURCE = "y.saoju"


def clean(value):
    return "" if value is None else str(value).strip()


def schedule_key(row):
    return tuple(clean(row.get(field)) for field in
                 ("date", "time", "city", "musical", "theatre"))


def schedule_core(row):
    return schedule_key(row)[:4]


def conflict_row(entity_type, record_key, field_name, existing, incoming):
    raw = json.dumps([entity_type, record_key, field_name, existing, incoming],
                     ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return {
        "fingerprint": hashlib.sha256(raw.encode("utf-8")).hexdigest(),
        "entity_type": entity_type,
        "record_key": record_key,
        "field_name": field_name,
        "existing_value": clean(existing),
        "incoming_value": clean(incoming),
        "incoming_source": SOURCE,
        "last_seen_at": "now()",
    }


def plan_schedules(local_rows, remote_rows):
    """Return local-id mapping, inserts, and near-duplicate conflicts."""
    exact = {schedule_key(row): row for row in remote_rows}
    by_core = {}
    for row in remote_rows:
        by_core.setdefault(schedule_core(row), []).append(row)

    mapping = {}
    inserts = []
    conflicts = []
    for row in local_rows:
        key = schedule_key(row)
        if key in exact:
            mapping[row["id"]] = exact[key]["id"]
            continue

        near = by_core.get(key[:4], [])
        if near:
            conflicts.append(conflict_row(
                "show", {"date": key[0], "time": key[1], "city": key[2],
                         "musical": key[3]}, "theatre",
                " | ".join(sorted({clean(item.get("theatre")) for item in near})),
                key[4]))
            continue

        inserts.append({"date": key[0], "time": key[1], "city": key[2],
                        "musical": key[3], "theatre": key[4],
                        "_local_id": row["id"]})
    return mapping, inserts, conflicts


class Supabase:
    def __init__(self, url, key):
        self.url = url.rstrip("/")
        self.headers = {
            "apikey": key,
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def fetch_all(self, table, columns):
        rows = []
        offset = 0
        while True:
            query = urllib.parse.urlencode({
                "select": ",".join(columns), "limit": "1000", "offset": str(offset)
            })
            req = urllib.request.Request(
                f"{self.url}/rest/v1/{table}?{query}", headers=self.headers, method="GET")
            with open_retry(req) as response:
                page = json.loads(response.read().decode("utf-8"))
            rows.extend(page)
            if len(page) < 1000:
                return rows
            offset += len(page)

    def post(self, table, rows, *, on_conflict=None, returning=False,
             resolution="merge-duplicates"):
        if not rows:
            return []
        query = ""
        if on_conflict:
            query = "?" + urllib.parse.urlencode({"on_conflict": on_conflict})
        headers = dict(self.headers)
        headers["Prefer"] = ("return=representation" if returning else "return=minimal")
        if on_conflict:
            headers["Prefer"] += ",resolution=" + resolution
        req = urllib.request.Request(
            f"{self.url}/rest/v1/{table}{query}",
            data=json.dumps(rows, ensure_ascii=False).encode("utf-8"),
            headers=headers, method="POST")
        with open_retry(req) as response:
            body = response.read()
        return json.loads(body.decode("utf-8")) if returning and body else []

    def rpc(self, function):
        req = urllib.request.Request(
            f"{self.url}/rest/v1/rpc/{function}", data=b"{}",
            headers=self.headers, method="POST")
        with open_retry(req) as response:
            response.read()


def add_missing_identities(db, client, table, columns, conflicts, row_allowed=None):
    local = get_rows(db, table, columns)
    remote_columns = [column for column in ("id", "name", "musical_id")
                      if column in columns]
    remote = client.fetch_all(table, remote_columns)
    remote_by_id = {row["id"]: row for row in remote}
    missing = []
    usable_ids = set()
    for row in local:
        if row_allowed is not None and not row_allowed(row):
            continue
        current = remote_by_id.get(row["id"])
        if current is None:
            for key in ("is_actor", "is_original"):
                if key in row and row[key] is not None:
                    row[key] = bool(row[key])
            missing.append(row)
            usable_ids.add(row["id"])
        else:
            differences = [field for field in ("name", "musical_id")
                           if field in remote_columns
                           and clean(current.get(field)) != clean(row.get(field))]
            if differences:
                for field in differences:
                    conflicts.append(conflict_row(
                        table[:-1], {"id": row["id"]}, field,
                        current.get(field), row.get(field)))
            else:
                usable_ids.add(row["id"])
    for batch in to_batches(missing):
        client.post(table, batch, on_conflict="id", resolution="ignore-duplicates")
    print(f"[{table}] 新增 {len(missing)}，保留线上已有字段")
    return usable_ids


def add_missing_links(db, client, table, columns, row_allowed=None):
    local = get_rows(db, table, columns)
    if row_allowed is not None:
        local = [row for row in local if row_allowed(row)]
    existing = {tuple(row.get(col) for col in columns)
                for row in client.fetch_all(table, columns)}
    missing = [row for row in local
               if tuple(row.get(col) for col in columns) not in existing]
    for batch in to_batches(missing):
        client.post(table, batch)
    print(f"[{table}] 新增 {len(missing)}，不删除线上人工补充")


def sync_schedules(db, client, conflicts, usable_artist_ids):
    local_shows = get_rows(db, "shows", ["id", "date", "time", "city", "musical", "theatre"])
    remote_shows = client.fetch_all(
        "shows", ["id", "date", "time", "city", "musical", "theatre"])
    mapping, inserts, show_conflicts = plan_schedules(local_shows, remote_shows)
    conflicts.extend(show_conflicts)

    for batch in to_batches(inserts):
        payload = [{key: value for key, value in row.items() if key != "_local_id"}
                   for row in batch]
        created = client.post(
            "shows", payload,
            on_conflict="date,time,city,musical,theatre", returning=True)
        created_by_key = {schedule_key(row): row["id"] for row in created}
        for row in batch:
            online_id = created_by_key.get(schedule_key(row))
            if online_id is None:
                raise RuntimeError("Supabase 未返回新增排期 ID，已停止以避免卡司错配")
            mapping[row["_local_id"]] = online_id

    local_casts = get_rows(db, "show_casts", ["show_id", "artist_id", "role"])
    remote_casts = client.fetch_all("show_casts", ["show_id", "artist_id", "role"])
    existing = {(row["show_id"], row["artist_id"], clean(row.get("role")))
                for row in remote_casts}
    missing_casts = []
    skipped_casts = 0
    for row in local_casts:
        if row["artist_id"] not in usable_artist_ids:
            skipped_casts += 1
            continue
        online_show_id = mapping.get(row["show_id"])
        if online_show_id is None:
            skipped_casts += 1
            continue
        candidate = (online_show_id, row["artist_id"], clean(row.get("role")))
        if candidate not in existing:
            missing_casts.append({"show_id": candidate[0], "artist_id": candidate[1],
                                  "role": candidate[2]})
            existing.add(candidate)
    for batch in to_batches(missing_casts):
        client.post("show_casts", batch,
                    on_conflict="show_id,artist_id,role",
                    resolution="ignore-duplicates")
    print(f"[shows] 新增 {len(inserts)}，近似冲突 {len(show_conflicts)}")
    print(f"[show_casts] 新增 {len(missing_casts)}，随冲突排期暂缓 {skipped_casts}")


def save_conflicts(client, conflicts):
    if not conflicts:
        print("[sync_conflicts] 无新增冲突")
        return
    # PostgREST cannot evaluate SQL expressions from JSON; server default handles first_seen.
    unique = {row["fingerprint"]: row for row in conflicts}
    conflicts = list(unique.values())
    for row in conflicts:
        row.pop("last_seen_at", None)
    for batch in to_batches(conflicts):
        client.post("sync_conflicts", batch, on_conflict="fingerprint")
    print(f"[sync_conflicts] 记录/更新 {len(conflicts)} 条，等待人工判断")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    env = load_env()
    url = os.environ.get("SUPABASE_URL", env.get("SUPABASE_URL", ""))
    key = os.environ.get("SUPABASE_SERVICE_KEY", env.get("SUPABASE_SERVICE_KEY", ""))
    if not url or not key:
        raise SystemExit("需要 SUPABASE_URL / SUPABASE_SERVICE_KEY")

    connection = sqlite3.connect(DB)
    db = connection.cursor()
    client = Supabase(url, key)
    conflicts = []
    try:
        # Fail before any writes when the required safety migration has not been installed.
        client.fetch_all("sync_conflicts", ["fingerprint"])
        artist_ids = add_missing_identities(
            db, client, "artists", ["id", "name", "is_actor"], conflicts)
        musical_ids = add_missing_identities(
            db, client, "musicals", ["id", "name", "is_original", "progress",
                                     "premiere_date", "info"], conflicts)
        role_ids = add_missing_identities(
            db, client, "roles", ["id", "musical_id", "name"], conflicts,
            row_allowed=lambda row: row["musical_id"] in musical_ids)
        add_missing_links(
            db, client, "actor_roles", ["artist_id", "musical_id", "role_id"],
            row_allowed=lambda row: (row["artist_id"] in artist_ids
                                     and row["musical_id"] in musical_ids
                                     and row["role_id"] in role_ids))
        sync_schedules(db, client, conflicts, artist_ids)
        save_conflicts(client, conflicts)
        client.rpc("rebuild_co_work")
        print("[co_work_edges] 已按 Supabase 合并后的全部同场卡司重算")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:500]
        raise SystemExit(f"Supabase HTTP {error.code}: {detail}") from error
    finally:
        connection.close()


if __name__ == "__main__":
    main()
