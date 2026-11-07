#!/usr/bin/env python3
"""Drop Pages-ineligible media from the branch tip.

GitHub Pages is still published from the main branch, and that setting cannot
be changed with the available tokens. The branch deploy therefore publishes
whatever is on the tip. This removes videos and unreferenced images older than
3 days from the tip only. The blobs stay in git history. Recent Reels, story
images, cover images, and the end card stay, which is what the 8am autopilot
posts to Instagram, Facebook, and Buffer.

Pass --commit to create the git commit. The caller pushes.
"""
import json
import os
import subprocess
import sys
import time

import stage_pages as sp

ARCHIVE_REASONS = {"video-old", "image-old"}


def plan(root, now=None):
    root = os.path.abspath(root)
    now = time.time() if now is None else now
    commit_times = sp.load_commit_times(root)
    refs = sp.collect_refs(root)
    victims = []
    kept_rels = []
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in sp.SKIP_DIRS and not d.startswith(".")]
        for name in files:
            src = os.path.join(dirpath, name)
            rel = sp.norm_rel(os.path.relpath(src, root))
            if rel == "videos/videos-index.json":
                continue
            age = None if rel not in commit_times else now - commit_times[rel]
            keep, reason = sp.decide(rel, age, rel in refs)
            if reason in ARCHIVE_REASONS:
                victims.append(rel)
            elif keep:
                kept_rels.append(rel)
    index_path = os.path.join(root, "videos", "videos-index.json")
    entries = []
    if os.path.isfile(index_path):
        with open(index_path, encoding="utf-8") as fh:
            entries = json.load(fh)
    new_index = sp.publish_video_index(entries, kept_rels, sp._posts_by_slug(root), commit_times)
    return victims, new_index


def apply_plan(root, victims, new_index, commit):
    index_path = os.path.join(root, "videos", "videos-index.json")
    os.makedirs(os.path.dirname(index_path), exist_ok=True)
    with open(index_path, "w", encoding="utf-8") as fh:
        json.dump(new_index, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    if victims:
        subprocess.check_call(["git", "rm", "-q", "--", *victims], cwd=root)
    subprocess.check_call(["git", "add", "--", "videos/videos-index.json"], cwd=root)
    staged = subprocess.check_output(["git", "diff", "--cached", "--name-only"], cwd=root, text=True).strip()
    if not staged:
        print("nothing to prune")
        return False
    if not commit:
        print(f"staged {len(staged.splitlines())} paths (not committed)")
        return True
    subprocess.check_call(
        ["git", "commit", "-q", "-m", "Archive media older than 3 days off the Pages branch\n\nThese files stay in git history. Recent Reels and page images stay on the branch so the public URLs used by Instagram, Facebook, and Buffer keep working."],
        cwd=root,
    )
    print(f"committed removal of {len(victims)} files")
    return True


def main(argv):
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    victims, new_index = plan(root)
    print(f"prune candidates: {len(victims)}  video index entries: {len(new_index)}")
    if "--commit" not in argv and "--apply" not in argv:
        for rel in victims:
            print(rel)
        return 0
    apply_plan(root, victims, new_index, commit="--commit" in argv)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
