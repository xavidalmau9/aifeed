#!/usr/bin/env python3
"""
AIFeed Video Sync — run this whenever a new branded video appears in ~/Downloads/
It auto-detects new MP4s, reads their LinkedIn captions, copies to repo,
updates videos-index.json, and commits + pushes to GitHub.

Usage:
  python3 /Users/305partners/aifeed/scripts/sync-videos.sh
  # or make it executable: chmod +x sync-videos.sh && ./sync-videos.sh
"""

import json, os, re, subprocess, sys
from pathlib import Path

REPO       = Path('/Users/305partners/aifeed')
VIDEOS_DIR = REPO / 'videos'
INDEX_FILE = REPO / 'videos' / 'videos-index.json'
DOWNLOADS  = Path.home() / 'Downloads'

def read_caption(ts):
    p = DOWNLOADS / f'caption_linkedin_{ts}.txt'
    if not p.exists():
        return None, None, None, None
    text = p.read_text().strip()
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    # Source line
    source, source_url = 'Unknown', ''
    for l in lines:
        if l.startswith('Source:'):
            source = l.replace('Source:', '').strip()
        if re.match(r'https?://www\.youtube\.com', l):
            source_url = l.strip()
    # Title: first non-empty line
    title = lines[0] if lines else 'AI News'
    # Caption: body paragraphs (skip bullets, skip Source, skip URLs, skip hashtags)
    body_lines = []
    for l in lines[1:]:
        if l.startswith('Source:') or re.match(r'https?://', l) or l.startswith('#') or l.startswith('•'):
            continue
        body_lines.append(l)
    caption = ' '.join(body_lines)[:350].strip()
    return title, caption, source, source_url

def get_ts(filename):
    m = re.search(r'aifeed_branded_(\d+)', filename)
    return m.group(1) if m else None

def main():
    # Load existing index
    existing = json.loads(INDEX_FILE.read_text())
    existing_files = {e['filename'] for e in existing}

    # Find all MP4s in Downloads
    mp4s = sorted(DOWNLOADS.glob('aifeed_branded_*.mp4'), key=lambda p: p.stat().st_mtime)
    new_videos = [p for p in mp4s if p.name not in existing_files]

    if not new_videos:
        print('✅ No new videos — index is up to date.')
        return

    print(f'Found {len(new_videos)} new video(s):')
    added = []
    for mp4 in new_videos:
        ts = get_ts(mp4.name)
        if not ts:
            print(f'  ⚠️  Skipping {mp4.name} — cannot parse timestamp')
            continue

        title, caption, source, source_url = read_caption(ts)
        if not caption:
            print(f'  ⚠️  Skipping {mp4.name} — no caption file found at {DOWNLOADS}/caption_linkedin_{ts}.txt')
            continue

        # Copy MP4 to repo videos/
        dest = VIDEOS_DIR / mp4.name
        if not dest.exists():
            print(f'  Copying {mp4.name} → videos/')
            import shutil; shutil.copy2(str(mp4), str(dest))
        else:
            print(f'  {mp4.name} already in videos/ (skipping copy)')

        # Build index entry
        from datetime import datetime
        mtime = datetime.fromtimestamp(mp4.stat().st_mtime).strftime('%Y-%m-%dT%H:%M:%SZ')
        entry = {
            'filename': mp4.name,
            'url': f'https://aifeed.run/videos/{mp4.name}',
            'title': title,
            'caption': caption,
            'source': source,
            'sourceUrl': source_url,
            'date': mtime
        }
        added.append(entry)
        print(f'  ✅ {mp4.name} → "{title}" ({source})')

    if not added:
        print('Nothing added.')
        return

    # Prepend new entries (newest first)
    updated = list(reversed(added)) + existing
    INDEX_FILE.write_text(json.dumps(updated, indent=2))
    print(f'\nUpdated videos-index.json — {len(updated)} total videos')

    # Git: pull, stage, commit, push
    os.chdir(REPO)
    subprocess.run(['git', 'pull', '--rebase'], check=False)
    subprocess.run(['git', 'add', 'videos/'], check=True)
    names = ', '.join(e['filename'] for e in added)
    msg = f'Add {len(added)} new video(s): {names}'
    result = subprocess.run(['git', 'diff', '--staged', '--quiet'])
    if result.returncode == 0:
        print('Nothing to commit (already pushed?).')
        return
    subprocess.run(['git', 'commit', '-m', msg], check=True)
    subprocess.run(['git', 'push'], check=True)
    print(f'\n🚀 Pushed {len(added)} video(s) to GitHub.')

if __name__ == '__main__':
    main()
