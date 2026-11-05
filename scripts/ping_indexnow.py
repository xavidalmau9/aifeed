#!/usr/bin/env python3
"""Ping IndexNow (Bing & partners) with sitemap URLs. Safe to re-run."""
import json, os, re, sys, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://aifeed.run"
KEY = "cc1f3906cab112076693c81a63f1071c"
sm = open(os.path.join(ROOT, "sitemap.xml"), encoding="utf-8").read()
urls = re.findall(r"<loc>(https://aifeed\.run[^<]+)</loc>", sm)
# IndexNow soft-caps large batches; send in chunks of 100
chunks = [urls[i:i+100] for i in range(0, len(urls), 100)] or [[SITE + "/"]]
ok = 0
for chunk in chunks:
    body = json.dumps({
        "host": "aifeed.run",
        "key": KEY,
        "keyLocation": f"{SITE}/{KEY}.txt",
        "urlList": chunk,
    }).encode()
    req = urllib.request.Request(
        "https://api.indexnow.org/indexnow",
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            print(f"IndexNow {r.status} for {len(chunk)} urls")
            ok += 1
    except Exception as e:
        # 200/202 success; some endpoints return 202 empty
        if hasattr(e, "code") and e.code in (200, 202):
            print(f"IndexNow {e.code} for {len(chunk)} urls")
            ok += 1
        else:
            print("IndexNow error:", e, file=sys.stderr)
print(f"done: {ok}/{len(chunks)} batches, {len(urls)} urls total")
