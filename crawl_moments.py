"""按图谱重要度前 N 位演员，从 B 站搜索高播放量的音乐剧精彩片段。

规则：
- 搜索词：演员名 + 音乐剧 / 返场
- 过滤：播放量 >= MIN_PLAY，标题包含演员名且含音乐剧选段特征词
- 每位演员取播放量最高的一条
结果写入 data/moments_crawled.json（人工复核后再并入 data/moments.json）

用法：python crawl_moments.py [TOP_N]
"""
import json
import http.cookiejar
import random
import re
import sys
import time
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
API = "https://api.bilibili.com/x/web-interface/search/type?search_type=video&page={page}&keyword={kw}"
SPI = "https://api.bilibili.com/x/frontend/finger/spi"
MIN_PLAY = 20000
TOP_N = int(sys.argv[1]) if len(sys.argv) > 1 else 50

# 音乐剧选段特征词（标题至少命中一个）
MUSICAL_KW = ["音乐剧", "返场", "唱段", "选段", "片段", "现场", "音乐会", "演唱"]
# 明显不是「选段」的内容
BAD_KW = ["采访", "专访", "访谈", "vlog", "VLOG", "直播回放", "连线", "合集", "纪录片", "幕后", "花絮", "练习室", "综艺"]


def make_opener():
    """先取 buvid3/buvid4 cookie（B 站反爬：无 cookie 会 412），再复用同一会话搜索"""
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    try:
        req = urllib.request.Request(SPI, headers={"User-Agent": UA, "Referer": "https://www.bilibili.com/"})
        with opener.open(req, timeout=20) as r:
            d = json.loads(r.read().decode("utf-8")).get("data") or {}
        if d.get("b_3"):
            cj.set_cookie(make_cookie("buvid3", d["b_3"]))
        if d.get("b_4"):
            cj.set_cookie(make_cookie("buvid4", d["b_4"]))
    except Exception as e:
        print("spi 取 cookie 失败: %s" % e, file=sys.stderr)
    return opener


def make_cookie(name, value):
    return http.cookiejar.Cookie(
        version=0, name=name, value=value, port=None, port_specified=False,
        domain=".bilibili.com", domain_specified=True, domain_initial_dot=True,
        path="/", path_specified=True, secure=False, expires=None,
        discard=True, comment=None, comment_url=None, rest={}, rfc2109=False,
    )


def search(kw, page=1):
    url = API.format(page=page, kw=urllib.parse.quote(kw))
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://www.bilibili.com/"})
    with OPENER.open(req, timeout=20) as r:
        data = json.loads(r.read().decode("utf-8"))
    return (data.get("data") or {}).get("result") or []


def parse_play(v):
    if isinstance(v, (int, float)):
        return int(v)
    m = re.match(r"([\d.]+)\s*(万)?", str(v))
    if not m:
        return 0
    n = float(m.group(1))
    return int(n * 10000) if m.group(2) else int(n)


def pick(items, actor):
    best = None
    for it in items:
        raw = it.get("title", "")
        title = re.sub(r"</?em[^>]*>", "", raw).strip()
        desc = re.sub(r"</?em[^>]*>", "", it.get("description", "") or "")
        play = parse_play(it.get("play"))
        if play < MIN_PLAY:
            continue
        if not any(k in title for k in MUSICAL_KW):
            continue
        if any(k in title for k in BAD_KW):
            continue
        # 演员名：标题优先；其次简介（简介常列卡司名单）
        if actor not in title and actor not in desc:
            continue
        if best is None or play > best["play"]:
            best = {
                "actor": actor,
                "title": title,
                "desc": desc[:80],
                "bvid": it.get("bvid"),
                "play": play,
                "duration": it.get("duration"),
                "author": it.get("author"),
                "url": "https://www.bilibili.com/video/" + (it.get("bvid") or ""),
            }
    return best


def main():
    global OPENER
    OPENER = make_opener()
    top = json.load(open("data/actor_priority.json", encoding="utf-8"))[:TOP_N]
    out = []
    for i, a in enumerate(top, 1):
        name = a["name"]
        found = None
        for kw in (name + " 音乐剧", name + " 返场", name + " 唱段", name + " 音乐剧选段"):
            for page in (1, 2):
                try:
                    items = search(kw, page)
                except Exception as e:
                    print("[%d/%d] %s 搜索失败: %s" % (i, len(top), name, e), file=sys.stderr)
                    time.sleep(2)
                    continue
                found = pick(items, name)
                if found:
                    break
                time.sleep(0.6)
            if found:
                break
        if found:
            out.append(found)
            print("[%d/%d] OK %s play=%d %s" % (i, len(top), name, found["play"], found["title"]))
        else:
            print("[%d/%d] -- %s 未找到播放量>=%d的音乐剧选段" % (i, len(top), name, MIN_PLAY))
        time.sleep(1.2)
    with open("data/moments_crawled.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print("已保存 %d 条到 data/moments_crawled.json" % len(out))


if __name__ == "__main__":
    main()
