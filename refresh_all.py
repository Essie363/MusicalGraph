"""One-command refresh: regenerate snapshots + frontend data after DB changes.

Usage: python refresh_all.py
Runs: snapshot_export.py -> export_graph.py
"""
import runpy
from pathlib import Path

BASE = Path(__file__).resolve().parent  # 脚本所在目录 = 项目根


def main():
    print("== 1/2 刷新快照 (data/snapshot_*.csv) ==")
    runpy.run_path(str(BASE / "snapshot_export.py"), run_name="__main__")
    print()
    print("== 2/2 刷新网页数据 (web/data.js) ==")
    runpy.run_path(str(BASE / "export_graph.py"), run_name="__main__")
    print()
    print("全部完成：快照 + 网页数据已更新")


if __name__ == "__main__":
    main()
