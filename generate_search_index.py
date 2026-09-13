"""Generate the browser-side actor search index.

The website stays dependency-free at runtime: this script converts actor names and
nicknames to full pinyin and initials ahead of time, then writes web/search_index.js.
Run it after changing actor names or nicknames, or use export_graph.py / refresh_all.py.
"""
import json
import sqlite3
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
DB = BASE / "music_graph.db"
OUT = BASE / "web" / "search_index.js"
LOCAL_PACKAGE_DIR = BASE / ".tools" / "pypinyin"

if LOCAL_PACKAGE_DIR.exists():
    sys.path.insert(0, str(LOCAL_PACKAGE_DIR))

from pypinyin import Style, lazy_pinyin


def _terms(value):
    """Return compact full-pinyin and initial-pinyin variants for a label."""
    text = str(value or "").strip()
    if not text:
        return []
    keep = lambda chars: list(chars)
    full = "".join(lazy_pinyin(text, style=Style.NORMAL, errors=keep)).lower()
    initials = "".join(lazy_pinyin(text, style=Style.FIRST_LETTER, errors=keep)).lower()
    raw = "".join(ch for ch in text.lower() if ch.isascii() and ch.isalnum())
    return [term for term in {full, initials, raw} if term]


def write_search_index(actors):
    """Write {actor id: searchable pinyin terms} for the front-end."""
    index = {}
    for actor_id, actor in actors.items():
        terms = []
        for label in (actor.get("name"), actor.get("nickname")):
            terms.extend(_terms(label))
        index[str(actor_id)] = " ".join(sorted(set(terms)))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "// 由 generate_search_index.py 自动生成，请勿手改\n"
        "window.MUSIC_GRAPH_SEARCH_INDEX = "
        + json.dumps(index, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    print("已导出:", OUT, "| 演员搜索索引:", len(index))


def main():
    conn = sqlite3.connect(DB)
    rows = conn.execute("SELECT id, name, nickname FROM artists").fetchall()
    conn.close()
    write_search_index({row[0]: {"name": row[1], "nickname": row[2]} for row in rows})


if __name__ == "__main__":
    main()
