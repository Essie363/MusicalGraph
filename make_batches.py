import json
from pathlib import Path

BASE = Path(__file__).resolve().parent  # 脚本所在目录 = 项目根
DATA = BASE / "data"
acts = json.load(open(DATA / "actor_priority.json", encoding="utf-8"))
top500 = acts[:500]
batches = [top500[i:i + 10] for i in range(0, len(top500), 10)]
out = []
for bi, b in enumerate(batches):
    out.append("BATCH %d: %s" % (bi, " | ".join("%s(id=%d)" % (a["name"], a["id"]) for a in b)))
open(DATA / "batches.txt", "w", encoding="utf-8").write("\n".join(out))
print("written", len(batches))
