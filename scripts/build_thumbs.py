#!/usr/bin/env python3
"""Make lightweight WebP card thumbnails for every post graphic in _posts/posts-index.json.
images/NAME.png -> thumbs/NAME-720.webp and thumbs/NAME-240.webp (full PNGs stay for story pages / OG).
Only missing thumbnails are generated. Image source order: local file, live site, git object (partial clone).
Run by .github/workflows/seo-build.yml. Never edits posts-index.json or images/."""
import io, json, os, re, subprocess, sys, urllib.request
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIZES = {720: 74, 240: 70}  # width: webp quality
os.makedirs(os.path.join(ROOT, "thumbs"), exist_ok=True)

def source_bytes(rel):
    p = os.path.join(ROOT, rel)
    if os.path.exists(p): return open(p, "rb").read()
    try:  # fast path: already deployed on the live site
        return urllib.request.urlopen("https://aifeed.run/" + rel, timeout=60).read()
    except Exception: pass
    try:  # brand-new image not deployed yet: read it from git (partial clone fetches the blob on demand)
        return subprocess.run(["git", "cat-file", "blob", f"HEAD:{rel}"], cwd=ROOT, capture_output=True, check=True, timeout=120).stdout
    except Exception: return None

posts = json.load(open(os.path.join(ROOT, "_posts/posts-index.json")))
made = skipped = failed = 0
for p in posts:
    m = re.match(r"^(?:https://aifeed\.run)?/?images/([^/?#]+)\.(png|jpe?g|webp)$", p.get("imageUrl") or "", re.I)
    if not m: continue
    name = m.group(1)
    outs = {w: os.path.join(ROOT, "thumbs", f"{name}-{w}.webp") for w in SIZES}
    if all(os.path.exists(o) for o in outs.values()): skipped += 1; continue
    data = source_bytes(f"images/{m.group(1)}.{m.group(2)}")
    if not data: failed += 1; print("missing source:", name, file=sys.stderr); continue
    try:
        im = Image.open(io.BytesIO(data)).convert("RGB")
        for w, q in SIZES.items():
            h = round(im.height * w / im.width)
            im.resize((w, h), Image.LANCZOS).save(outs[w], "WEBP", quality=q, method=6)
        made += 1
    except Exception as e:
        failed += 1; print("failed:", name, e, file=sys.stderr)
print(f"thumbs: {made} made, {skipped} up to date, {failed} failed")
