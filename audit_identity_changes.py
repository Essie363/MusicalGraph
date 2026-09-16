"""Audit source IDs whose artist names changed across committed snapshots.

The upstream schedule source has occasionally reused an artist ID.  This script
does not modify the database: it compares each committed artists snapshot on
the current branch and writes a small JSON/Markdown review report.
"""

from __future__ import annotations

import csv
import io
import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SNAPSHOT = "data/snapshot_artists.csv"
JSON_OUTPUT = ROOT / "data" / "identity_change_audit.json"
MARKDOWN_OUTPUT = ROOT / "docs" / "identity_change_audit.md"
CORRECTIONS = ROOT / "data" / "identity_corrections.json"
RECOVERY_RESULT = ROOT / "data" / "identity_recovery_result.json"


def git(*args: str) -> str:
    return subprocess.check_output(
        ["git", *args], cwd=ROOT, text=True, encoding="utf-8", errors="replace"
    )


def read_snapshot(commit: str) -> dict[str, dict[str, str]]:
    content = git("show", f"{commit}:{SNAPSHOT}")
    rows = csv.DictReader(io.StringIO(content.lstrip("\ufeff")))
    return {row["id"]: row for row in rows}


def main() -> None:
    fixed_ids = {
        item["artist_id"]
        for item in json.loads(CORRECTIONS.read_text(encoding="utf-8")).get("corrections", [])
    } if CORRECTIONS.exists() else set()
    recovered_ids = {
        item["artist_id"]
        for item in json.loads(RECOVERY_RESULT.read_text(encoding="utf-8")).get("records", [])
    } if RECOVERY_RESULT.exists() else set()
    commits = git(
        "log", "--first-parent", "--format=%H%x1f%ad%x1f%s", "--date=short",
        "--reverse", "HEAD", "--", SNAPSHOT,
    ).splitlines()

    previous: dict[str, dict[str, str]] = {}
    changes: list[dict[str, str]] = []
    for line in commits:
        commit, date, subject = line.split("\x1f", 2)
        current = read_snapshot(commit)
        for artist_id, row in current.items():
            old = previous.get(artist_id)
            if old and old["name"].strip() and row["name"].strip() and old["name"] != row["name"]:
                changes.append({
                    "id": artist_id,
                    "previous_name": old["name"],
                    "current_name": row["name"],
                    "date": date,
                    "commit": commit[:7],
                    "subject": subject,
                    "previous_nickname": old.get("nickname", ""),
                    "current_nickname": row.get("nickname", ""),
                    "status": (
                        "本地已恢复，云端待同步" if int(artist_id) in recovered_ids
                        else "已修复" if int(artist_id) in fixed_ids
                        else "待人工确认"
                    ),
                })
        previous = current

    JSON_OUTPUT.write_text(
        json.dumps({"changes": changes}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    lines = [
        "# 演员来源 ID 身份变更审计",
        "",
        "本报告仅比对当前分支 Git 历史中的 `data/snapshot_artists.csv`，不会修改数据库。",
        "同一 ID 的姓名变化需要人工确认，通常意味着来源 ID 被复用或上游数据修正。",
        "",
        f"共发现 **{len(changes)}** 条候选记录。",
        "",
        "| ID | 原姓名 | 变更后姓名 | 日期 | 提交 | 昵称变化 | 状态 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for item in changes:
        nicknames = f"{item['previous_nickname'] or '无'} → {item['current_nickname'] or '无'}"
        lines.append(
            f"| {item['id']} | {item['previous_name']} | {item['current_name']} | "
            f"{item['date']} | `{item['commit']}` | {nicknames} | {item['status']} |"
        )
    MARKDOWN_OUTPUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {len(changes)} candidates to {MARKDOWN_OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
