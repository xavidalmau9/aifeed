#!/usr/bin/env python3
"""Stage the GitHub Pages publish directory.

The site repo keeps every Reel, branded video, and graphic. Pages was deploying
that whole tree (about 1.3GB) and the deploy timed out past the 1GB artifact
soft limit. This script copies only what the public site and in-flight social
posts need:

- Article pages, sitemap, RSS, llms.txt, llms-full.txt, thumbnails, and every
  cover / og image those pages reference.
- Reel mp4s, covers, and story/carousel images committed within the last 3 days,
  so Instagram, Facebook, and Buffer can still fetch the public URL (including
  the LinkedIn image fallback and the end card).
- videos/videos-index.json rewritten to the files actually published, plus any
  recent Reel that is not already in the archive index.
- Every published HTML page includes _includes/analytics.html (Clarity + GA4)
  exactly once. Pages that already have that block are not tagged again.

Older videos stay in git. They are not deleted and they are not in the artifact.
"""
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import time

from analytics_snippet import inject as inject_analytics

RETAIN_DAYS = 3
RETAIN_SECONDS = RETAIN_DAYS * 24 * 3600
# Stay under the ~1GB Pages soft limit with room for new covers. Target is <600MB.
MAX_BYTES = 600 * 1024 * 1024
SITE = "https://aifeed.run"

# Sentinel: this branded video is years older than the retention window. If git
# history is shallow, every path looks like it was touched by HEAD and this file
# would look new. Refuse to stage rather than publish the whole video library.
AGE_SENTINEL = "videos/aifeed_branded_1780346353.mp4"
SENTINEL_MIN_AGE_DAYS = 30

ROOT_FILES = {
    "index.html",
    "post.html",
    "404.html",
    "robots.txt",
    "sitemap.xml",
    "feed.xml",
    "llms.txt",
    "llms-full.txt",
    "CNAME",
    ".nojekyll",
    "og-default.png",
    "og-image.png",
    "AIFeed_MediaKit.pdf",
    "cc1f3906cab112076693c81a63f1071c.txt",
}
SITE_DIRS = {"about", "faq", "subscribe", "newsletter", "privacy", "news", "thumbs", "_posts"}
SKIP_DIRS = {".git", "graphics", "automation", "brand", "scripts", ".github", "_data", "_includes", "_site", "node_modules", "__pycache__"}
ALWAYS_IMAGES = {"images/aifeed_endslide.png"}
VIDEO_EXTS = {".mp4", ".jpg", ".jpeg", ".png", ".webp"}
REF_RE = re.compile(
    r"(?:https?://(?:www\.)?aifeed\.run)?/?"
    r"((?:images|thumbs|videos|media|newsletter)/[A-Za-z0-9_./%\-]+\.(?:png|jpe?g|webp|gif|svg|mp4))",
    re.I,
)
SCAN_EXT = {".html", ".xml", ".txt", ".json", ".css", ".js", ".svg"}


def _stamp_analytics(path, size):
    """Insert the shared Clarity + GA4 snippet once. Returns the file size in bytes."""
    with open(path, encoding="utf-8") as fh:
        original = fh.read()
    updated = inject_analytics(original)
    if updated == original:
        return size
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(updated)
    return os.path.getsize(path)


def norm_rel(rel):
    rel = str(rel or "").replace("\\", "/").strip()
    while rel.startswith("./"):
        rel = rel[2:]
    return rel.lstrip("/")


def decide(rel, age_seconds, referenced):
    """Return (keep, reason) for a repo-relative path.

    age_seconds is None when git has no commit for the path.
    referenced is True when a published page or posts-index points at the file.
    """
    rel = norm_rel(rel)
    if rel in ROOT_FILES:
        return True, "site"
    top = rel.split("/", 1)[0]
    if top in SKIP_DIRS:
        return False, "dev"
    if rel.startswith("videos/"):
        if rel == "videos/videos-index.json":
            return True, "video-index"
        ext = os.path.splitext(rel)[1].lower()
        if ext not in VIDEO_EXTS:
            return False, "video-other"
        if age_seconds is None:
            return True, "video-undated"
        if age_seconds <= RETAIN_SECONDS:
            return True, "video-recent"
        return False, "video-old"
    if rel.startswith("media/"):
        ext = os.path.splitext(rel)[1].lower()
        if ext in VIDEO_EXTS and age_seconds is not None and age_seconds <= RETAIN_SECONDS:
            return True, "video-recent"
        if referenced:
            return True, "referenced"
        return False, "video-old"
    if rel.startswith("images/"):
        if referenced or rel in ALWAYS_IMAGES:
            return True, "image-page"
        if age_seconds is not None and age_seconds <= RETAIN_SECONDS:
            return True, "image-recent"
        return False, "image-old"
    if top in SITE_DIRS:
        return True, "site"
    return False, "dev"


def url_to_rel(url):
    if not url:
        return ""
    path = str(url).split("?", 1)[0].split("#", 1)[0]
    for prefix in (SITE + "/", "http://aifeed.run/", "/"):
        if path.startswith(prefix):
            path = path[len(prefix):]
            break
    return norm_rel(path)


def publish_video_index(entries, kept_rels, posts_by_slug, commit_times):
    """Index of videos that will actually be on the site, newest first.

    Archived entries whose mp4 was left out are dropped. Recent Reels are added
    so the homepage player does not point at files Pages is not serving, and
    does not fall through to the full git index.
    """
    kept = set(kept_rels)
    out = []
    seen = set()
    for entry in entries or []:
        if not isinstance(entry, dict):
            continue
        rel = url_to_rel(entry.get("url") or "")
        if not rel:
            name = entry.get("filename") or ""
            rel = "videos/" + name if name else ""
        if rel in kept and rel.endswith(".mp4"):
            out.append(entry)
            seen.add(rel)
    for rel in sorted(kept):
        if rel in seen or not rel.endswith(".mp4") or not rel.startswith("videos/"):
            continue
        slug = os.path.splitext(os.path.basename(rel))[0]
        post = posts_by_slug.get(slug) or {}
        ts = commit_times.get(rel)
        if post.get("publishedAt"):
            date = post["publishedAt"]
        elif ts:
            date = datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        else:
            date = ""
        out.append({
            "filename": os.path.basename(rel),
            "url": SITE + "/" + rel,
            "title": post.get("headline") or slug.replace("-", " "),
            "caption": post.get("summary") or "",
            "source": post.get("sourceName") or "",
            "sourceUrl": post.get("sourceUrl") or "",
            "date": date,
        })
    out.sort(key=lambda e: str(e.get("date") or ""), reverse=True)
    return out


def load_commit_times(root):
    shallow = subprocess.run(
        ["git", "rev-parse", "--is-shallow-repository"],
        cwd=root, capture_output=True, text=True, check=True,
    ).stdout.strip()
    if shallow == "true":
        raise SystemExit("stage_pages: shallow git checkout cannot date videos; use fetch-depth: 0")
    proc = subprocess.run(
        ["git", "log", "--pretty=format:%ct", "--name-only"],
        cwd=root, capture_output=True, text=True, check=True,
    )
    last = {}
    current = None
    for line in proc.stdout.splitlines():
        if not line:
            continue
        if line.isdigit():
            current = int(line)
            continue
        if current is not None and line not in last:
            last[line] = current
    return last


def collect_refs(root):
    refs = set()
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        for name in files:
            if os.path.splitext(name)[1].lower() not in SCAN_EXT:
                continue
            path = os.path.join(dirpath, name)
            try:
                with open(path, encoding="utf-8", errors="ignore") as fh:
                    text = fh.read()
            except OSError:
                continue
            for match in REF_RE.findall(text):
                rel = url_to_rel(match)
                if rel:
                    refs.add(rel.split("?", 1)[0])
    return refs


def _posts_by_slug(root):
    path = os.path.join(root, "_posts", "posts-index.json")
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, encoding="utf-8") as fh:
            posts = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return {}
    out = {}
    for post in posts if isinstance(posts, list) else []:
        slug = post.get("slug") if isinstance(post, dict) else None
        if slug and slug not in out:
            out[slug] = post
    return out


def stage(root, dest, now=None):
    root = os.path.abspath(root)
    dest = os.path.abspath(dest)
    if os.path.commonpath([root, dest]) == root:
        raise SystemExit("stage_pages: publish directory must be outside the repo tree")
    now = time.time() if now is None else now
    commit_times = load_commit_times(root)
    if os.path.isfile(os.path.join(root, AGE_SENTINEL)):
        ts = commit_times.get(AGE_SENTINEL)
        if ts is None or (now - ts) / 86400 < SENTINEL_MIN_AGE_DAYS:
            age = "missing" if ts is None else f"{(now - ts) / 86400:.1f}d"
            raise SystemExit(
                f"stage_pages: refusing to trust video ages ({AGE_SENTINEL} looks {age}; "
                "expected an old branded video). Checkout full history with fetch-depth: 0."
            )
    refs = collect_refs(root)
    posts_by_slug = _posts_by_slug(root)
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    os.makedirs(dest, exist_ok=True)

    kept = []  # (rel, size, reason)
    omitted = []
    undated_video_bytes = 0
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        for name in files:
            src = os.path.join(dirpath, name)
            rel = norm_rel(os.path.relpath(src, root))
            if rel == "videos/videos-index.json":
                continue
            age = None if rel not in commit_times else now - commit_times[rel]
            keep, reason = decide(rel, age, rel in refs)
            try:
                size = os.path.getsize(src)
            except OSError:
                continue
            if not keep:
                omitted.append((rel, size, reason))
                continue
            if reason == "video-undated":
                undated_video_bytes += size
            target = os.path.join(dest, rel)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            shutil.copy2(src, target)
            if rel.lower().endswith(".html"):
                size = _stamp_analytics(target, size)
            kept.append((rel, size, reason))

    if undated_video_bytes > 20 * 1024 * 1024:
        raise SystemExit(
            f"stage_pages: {undated_video_bytes / 1024 / 1024:.1f}MB of videos have no git date; "
            "refusing to publish them blind"
        )

    index_path = os.path.join(root, "videos", "videos-index.json")
    entries = []
    if os.path.isfile(index_path):
        try:
            with open(index_path, encoding="utf-8") as fh:
                entries = json.load(fh)
        except (OSError, json.JSONDecodeError):
            entries = []
    kept_rels = [rel for rel, _, _ in kept]
    published_index = publish_video_index(entries, kept_rels, posts_by_slug, commit_times)
    index_target = os.path.join(dest, "videos", "videos-index.json")
    os.makedirs(os.path.dirname(index_target), exist_ok=True)
    with open(index_target, "w", encoding="utf-8") as fh:
        json.dump(published_index, fh, ensure_ascii=False, indent=2)
    index_size = os.path.getsize(index_target)
    kept.append(("videos/videos-index.json", index_size, "video-index"))

    # Every page-referenced image that exists in the repo must ship.
    missing_refs = []
    for rel in sorted(refs):
        if not rel.startswith("images/"):
            continue
        if os.path.isfile(os.path.join(root, rel)) and not os.path.isfile(os.path.join(dest, rel)):
            missing_refs.append(rel)
    if missing_refs:
        raise SystemExit("stage_pages: page images missing from publish dir: " + ", ".join(missing_refs[:12]))

    # Every Reel/video committed inside the retention window must ship.
    missing_recent = []
    for rel, ts in commit_times.items():
        if not rel.endswith(".mp4"):
            continue
        if not (rel.startswith("videos/") or rel.startswith("media/")):
            continue
        if now - ts <= RETAIN_SECONDS and not os.path.isfile(os.path.join(dest, rel)):
            if os.path.isfile(os.path.join(root, rel)):
                missing_recent.append(rel)
    if missing_recent:
        raise SystemExit("stage_pages: recent videos missing from publish dir: " + ", ".join(missing_recent[:12]))

    for required in ("index.html", "sitemap.xml", "llms.txt", "llms-full.txt", "CNAME", ".nojekyll", "images/aifeed_endslide.png"):
        if os.path.isfile(os.path.join(root, required)) and not os.path.isfile(os.path.join(dest, required)):
            raise SystemExit("stage_pages: required file missing from publish dir: " + required)

    total = sum(size for _, size, _ in kept)
    if total >= MAX_BYTES:
        raise SystemExit(
            f"stage_pages: publish dir is {total / 1024 / 1024:.1f}MB, over the {MAX_BYTES / 1024 / 1024:.0f}MB cap"
        )
    return {
        "bytes": total,
        "files": len(kept),
        "kept": kept,
        "omitted": omitted,
        "videos_published": sum(1 for rel, _, _ in kept if rel.endswith(".mp4")),
        "video_index": len(published_index),
    }


def _summarize(rows):
    buckets = {}
    for rel, size, reason in rows:
        count, total = buckets.get(reason, (0, 0))
        buckets[reason] = (count + 1, total + size)
    return buckets


def main(argv):
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dest = argv[1] if len(argv) > 1 else os.path.join(root, "..", "aifeed-pages")
    report = stage(root, dest)
    kept_b = _summarize(report["kept"])
    omit_b = _summarize(report["omitted"])
    print(f"publish dir: {dest}")
    print(f"files: {report['files']}  size: {report['bytes'] / 1024 / 1024:.1f}MB  videos: {report['videos_published']}  video index: {report['video_index']}")
    for reason, (count, total) in sorted(kept_b.items()):
        print(f"  keep {reason}: {count} files, {total / 1024 / 1024:.1f}MB")
    for reason, (count, total) in sorted(omit_b.items()):
        print(f"  omit {reason}: {count} files, {total / 1024 / 1024:.1f}MB")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
