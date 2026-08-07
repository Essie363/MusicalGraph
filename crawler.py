import json
import os
import sys
import time
import requests

from pathlib import Path
BASE = Path(__file__).resolve().parent  # 脚本所在目录 = 项目根
RAW_DIR = BASE / "data" / "raw"
os.makedirs(RAW_DIR, exist_ok=True)

artists = json.load(open(BASE / "data" / "api_raw" / "artist_raw.json", encoding="utf-8"))
mc = json.load(open(BASE / "data" / "api_raw" / "musicalcast_raw.json", encoding="utf-8"))

actor_ids = sorted(set(a["fields"]["artist"] for a in mc))

session = requests.Session()
session.headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"

def fetch(artist_id):
    path = os.path.join(RAW_DIR, f"{artist_id}.csv")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return True
    for attempt in range(4):
        try:
            r = session.get(f"https://y.saoju.net/yyj/artist/{artist_id}/download", timeout=60)
            if r.status_code == 200:
                with open(path, "wb") as f:
                    f.write(r.content)
                return True
        except requests.RequestException:
            pass
        time.sleep(2 * (attempt + 1))
    print(f"FAILED: {artist_id}", flush=True)
    return False

total = len(actor_ids)
done = sum(1 for a in actor_ids if os.path.exists(os.path.join(RAW_DIR, f"{a}.csv")) and os.path.getsize(os.path.join(RAW_DIR, f"{a}.csv")) > 0)
print(f"actors to crawl: {total}, already cached: {done}", flush=True)

start = time.time()
for i, aid in enumerate(actor_ids, 1):
    if os.path.exists(os.path.join(RAW_DIR, f"{aid}.csv")) and os.path.getsize(os.path.join(RAW_DIR, f"{aid}.csv")) > 0:
        continue
    fetch(aid)
    if i % 100 == 0:
        elapsed = time.time() - start
        print(f"{i}/{total} ({elapsed:.0f}s elapsed)", flush=True)
    time.sleep(0.15)

print("CRAWL DONE", flush=True)
