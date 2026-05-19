#!/usr/bin/env python3
"""
AIFeed Video Sync — detects new branded videos in ~/Downloads, copies to repo,
updates videos-index.json, commits + pushes to GitHub.

Runs automatically via launchd (WatchPaths fires on Downloads change + every 5 min).
Manual run:
  python3 /Users/305partners/aifeed/scripts/sync-videos.sh
"""

import json, os, re, shutil, subprocess, sys, time
from datetime import datetime
from pathlib import Path

REPO         = Path('/Users/305partners/aifeed')
VIDEOS_DIR   = REPO / 'videos'
INDEX_FILE   = REPO / 'videos' / 'videos-index.json'
DOWNLOADS    = Path('/Users/305partners/Downloads')
PENDING_FILE = Path('/tmp/aifeed-video-pending.json')   # videos waiting for their caption

def git(*args, check=True, ignore_errors=False):
    result = subprocess.run(['git', '-C', str(REPO)] + list(args),
                            capture_output=True, text=True)
    if not ignore_errors and check and result.returncode != 0:
        print(f'git {" ".join(args)} failed:\n{result.stderr.strip()}')
        raise SystemExit(1)
    return result

def read_caption(ts):
    p = DOWNLOADS / f'caption_linkedin_{ts}.txt'
    if not p.exists():
        return None, None, None, None
    # Wait briefly in case file is still being written
    time.sleep(1)
    text = p.read_text(encoding='utf-8', errors='ignore').strip()
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    if not lines:
        return None, None, None, None

    source, source_url = 'Unknown', ''
    for l in lines:
        if l.startswith('Source:'):
            source = l.replace('Source:', '').strip()
        if re.match(r'https?://www\.youtube\.com', l):
            source_url = l.strip()

    title = lines[0][:120]

    body = []
    for l in lines[1:]:
        if (l.startswith('Source:') or re.match(r'https?://', l)
                or l.startswith('#') or l.startswith('•') or l.startswith('📺')):
            continue
        body.append(l)
    caption = ' '.join(body)[:350].strip()

    return title, caption, source, source_url

def get_ts(filename):
    m = re.search(r'aifeed_branded_(\d+)', filename)
    return m.group(1) if m else None

def load_pending():
    """Load the list of video filenames that were detected but had no caption yet."""
    if PENDING_FILE.exists():
        try:
            return set(json.loads(PENDING_FILE.read_text()))
        except Exception:
            pass
    return set()

def save_pending(pending):
    if pending:
        PENDING_FILE.write_text(json.dumps(list(pending)))
    elif PENDING_FILE.exists():
        PENDING_FILE.unlink()

def main():
    print(f'\n[{datetime.now().strftime("%Y-%m-%d %H:%M:%S")}] AIFeed Video Sync starting…')

    # Always force index to match remote — no stash, no local contamination
    fetch = git('fetch', 'origin', 'main', check=False)
    if fetch.returncode != 0:
        print(f'Warning: git fetch failed — {fetch.stderr.strip()}\nProceeding with local index.')
    else:
        git('checkout', 'origin/main', '--', 'videos/videos-index.json', check=False, ignore_errors=True)
        print('Synced index from origin/main.')

    # Read index fresh from remote state
    existing = json.loads(INDEX_FILE.read_text(encoding='utf-8'))
    existing_files = {e['filename'] for e in existing}

    # Find MP4s in Downloads not yet indexed
    mp4s = sorted(DOWNLOADS.glob('aifeed_branded_*.mp4'), key=lambda p: p.stat().st_mtime)
    new_videos = [p for p in mp4s if p.name not in existing_files]

    # Also retry any previously pending videos (caption may have arrived since)
    pending = load_pending()
    pending_paths = [DOWNLOADS / fn for fn in pending if (DOWNLOADS / fn).exists() and fn not in existing_files]
    for p in pending_paths:
        if p not in new_videos:
            new_videos.append(p)
            print(f'  ↩  Retrying pending: {p.name}')

    if not new_videos:
        print('✅ No new videos — index is up to date.')
        save_pending(set())  # clear any stale pending
        return

    print(f'Found {len(new_videos)} new video(s):')
    added = []
    still_pending = set()

    for mp4 in new_videos:
        ts = get_ts(mp4.name)
        if not ts:
            print(f'  ⚠  Skipping {mp4.name} — cannot parse timestamp')
            continue

        title, caption, source, source_url = read_caption(ts)
        if not title:
            print(f'  ⏳ {mp4.name} — caption_linkedin_{ts}.txt not ready yet, queuing for retry')
            still_pending.add(mp4.name)
            continue

        dest = VIDEOS_DIR / mp4.name
        if not dest.exists():
            print(f'  Copying {mp4.name} ({mp4.stat().st_size // 1024 // 1024}MB) → videos/')
            shutil.copy2(str(mp4), str(dest))
        else:
            print(f'  {mp4.name} already in videos/ (skipping copy)')

        mtime = datetime.fromtimestamp(mp4.stat().st_mtime).strftime('%Y-%m-%dT%H:%M:%SZ')
        added.append({
            'filename': mp4.name,
            'url': f'https://aifeed.run/videos/{mp4.name}',
            'title': title,
            'caption': caption,
            'source': source,
            'sourceUrl': source_url,
            'date': mtime
        })
        print(f'  ✅ {mp4.name} — "{title[:80]}" ({source})')

    # Save pending state (will be retried on next run)
    save_pending(still_pending)
    if still_pending:
        print(f'  ℹ  {len(still_pending)} video(s) queued — will retry in next run (≤5 min)')

    if not added:
        print('Nothing to commit this run.')
        return

    # Prepend newest first
    updated = list(reversed(added)) + existing
    INDEX_FILE.write_text(json.dumps(updated, indent=2), encoding='utf-8')
    print(f'\nUpdated videos-index.json — {len(updated)} total videos')

    # Stage, commit, push
    git('add', 'videos/')
    staged = git('diff', '--staged', '--quiet', check=False)
    if staged.returncode == 0:
        print('Nothing staged to commit.')
        return

    names = ', '.join(e['filename'] for e in added)
    git('commit', '-m', f'Add {len(added)} new video(s): {names}')

    push = git('push', check=False)
    if push.returncode != 0:
        print('Push rejected — pulling and retrying…')
        git('pull', '--rebase', 'origin', 'main')
        git('push')

    print(f'\n🚀 Pushed {len(added)} video(s) to GitHub.')

if __name__ == '__main__':
    main()
