#!/usr/bin/env python3
"""AIFeed.run Reel builder: one story -> 1080x1920 H.264/AAC MP4 (~22s).

Scenes: hook (feed graphic + headline), 3 key points from the story, brand end card.
Audio: an original ambient bed synthesized here with numpy (no third-party music, no licensing).
Free tools only: Python 3 + Pillow + numpy + ffmpeg.

Usage:
  python3 make_reel.py --post post.json --image feed.png --out reel.mp4
  post.json = an entry of _posts/posts-index.json (headline, summary, body, source...)
"""
import argparse, html, json, os, re, subprocess, sys, tempfile, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1080, 1920, 30
HERE = os.path.dirname(os.path.abspath(__file__))
FONT = lambda name, size: ImageFont.truetype(os.path.join(HERE, 'fonts', f'Poppins-{name}.ttf'), size)
ACCENT = (255, 140, 0)
GREEN = (50, 215, 110)
BG = (10, 10, 18)
BANNED = re.compile(r'\b(daily|hand[- ]?edited|human[- ]?edited|edited by (a )?human|our editors?)\b', re.I)

SCENES = [('hook', 5.5), ('p1', 4.2), ('p2', 4.2), ('p3', 4.2), ('end', 4.4)]
XF = 0.4  # crossfade seconds


def clean(s):
    s = html.unescape(re.sub(r'<[^>]+>', ' ', s or ''))
    return re.sub(r'\s+', ' ', s).strip()


def sentences(text):
    return [x.strip() for x in re.split(r'(?<=[.!?])\s+(?=[A-Z"\u201c])', text) if len(x.strip()) > 25]


def shorten(s, n=150):
    if len(s) <= n:
        return s
    cut = s[:n].rsplit(' ', 1)[0].rstrip(',;:')
    return cut + '\u2026'


def key_points(post):
    """3 short, distinct points taken verbatim from the published story text (no new claims)."""
    paras = [clean(p) for p in re.findall(r'<p>(.*?)</p>', post.get('body', ''), re.S)] or [clean(post.get('body', ''))]
    head = clean(post.get('headline', '')).lower()
    pool, seen = [], []
    first = sentences(clean(post.get('summary', '')))
    for s in first + [s for p in paras[1:] for s in sentences(p)[:1]] + [s for p in paras for s in sentences(p)]:
        words = set(re.findall(r'[a-z0-9]{4,}', s.lower()))
        if s.lower() == head or BANNED.search(s) or len(s) > 175:
            continue
        if any(len(words & o) / max(1, min(len(words), len(o))) > 0.5 for o in seen):
            continue
        seen.append(words)
        pool.append(shorten(s))
        if len(pool) == 3:
            break
    while len(pool) < 3:
        pool.append('Full story at aifeed.run')
    return pool


def wrap(draw, text, font, maxw):
    lines, cur = [], ''
    for w in text.split():
        t = (cur + ' ' + w).strip()
        if draw.textlength(t, font=font) <= maxw:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def fit_text(draw, text, name, maxw, maxh, start, minsize=40, spacing=1.18):
    size = start
    while size >= minsize:
        f = FONT(name, size)
        lines = wrap(draw, text, f, maxw)
        lh = int(size * spacing)
        if lh * len(lines) <= maxh:
            return f, lines, lh
        size -= 4
    f = FONT(name, minsize)
    return f, wrap(draw, text, f, maxw), int(minsize * spacing)


def backdrop(photo):
    bg = photo.copy().convert('RGB')
    s = max(W / bg.width, H / bg.height)
    bg = bg.resize((int(bg.width * s) + 1, int(bg.height * s) + 1), Image.LANCZOS)
    l, t = (bg.width - W) // 2, (bg.height - H) // 2
    bg = bg.crop((l, t, l + W, t + H)).filter(ImageFilter.GaussianBlur(40))
    return Image.blend(bg, Image.new('RGB', (W, H), BG), 0.72)


def brand_bar(img, d):
    d.text((80, 110), 'AIFeed', font=FONT('Bold', 54), fill='white')
    x = 80 + d.textlength('AIFeed', font=FONT('Bold', 54))
    d.text((x, 110), '.run', font=FONT('Bold', 54), fill=ACCENT)


def scene_hook(photo, feed, post):
    img = backdrop(photo); d = ImageDraw.Draw(img)
    brand_bar(img, d)
    d.rounded_rectangle((80, 210, 80 + 300, 270), 30, fill=ACCENT)
    d.text((230, 240), 'AI NEWS', font=FONT('Bold', 34), fill='black', anchor='mm')
    f = feed.convert('RGB'); s = 900 / f.width
    f = f.resize((900, int(f.height * s)), Image.LANCZOS)
    y = 320
    img.paste(f, (90, y))
    hy = y + f.height + 40
    font, lines, lh = fit_text(d, clean(post['headline']), 'Bold', 920, H - hy - 120, 64)
    for i, ln in enumerate(lines):
        d.text((80, hy + i * lh), ln, font=font, fill='white')
    return img


def scene_point(photo, n, text, src):
    img = backdrop(photo); d = ImageDraw.Draw(img)
    brand_bar(img, d)
    d.text((80, 520), f'{n:02d}', font=FONT('Bold', 150), fill=ACCENT)
    d.rectangle((80, 720, 240, 730), fill=ACCENT)
    font, lines, lh = fit_text(d, text, 'SemiBold', 920, 760, 76)
    for i, ln in enumerate(lines):
        d.text((80, 790 + i * lh), ln, font=font, fill='white')
    if src:
        d.text((80, H - 200), 'Source: ' + src, font=FONT('Regular', 38), fill=(170, 170, 190))
    return img


def scene_end():
    img = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(img)
    for r in range(700, 0, -20):  # soft orange glow
        a = int(28 * (1 - r / 700))
        d.ellipse((W / 2 - r, 820 - r, W / 2 + r, 820 + r), fill=(10 + a, 10 + a // 2, 18))
    f = FONT('Bold', 150)
    tw = d.textlength('AIFeed', font=f) + d.textlength('.run', font=f)
    x = (W - tw) / 2
    d.text((x, 720), 'AIFeed', font=f, fill='white')
    d.text((x + d.textlength('AIFeed', font=f), 720), '.run', font=f, fill=ACCENT)
    d.text((W / 2, 980), 'The AI news that matters.', font=FONT('Regular', 54), fill=(210, 210, 225), anchor='mm')
    d.rounded_rectangle((W / 2 - 330, 1180, W / 2 + 330, 1290), 55, outline=GREEN, width=5)
    d.text((W / 2, 1235), 'Follow @aifeed.run', font=FONT('SemiBold', 48), fill=GREEN, anchor='mm')
    d.text((W / 2, 1400), 'Free newsletter at aifeed.run', font=FONT('Regular', 40), fill=(170, 170, 190), anchor='mm')
    return img


def music(path, dur, seed=0):
    """Original ambient pad + soft pulse, synthesized locally (royalty-free by construction)."""
    sr = 44100; t = np.arange(int(sr * dur)) / sr
    rng = np.random.default_rng(seed)
    roots = [[220.0, 261.63, 329.63], [196.0, 246.94, 293.66], [174.61, 220.0, 261.63], [196.0, 246.94, 329.63]]
    if seed % 2:
        roots = roots[1:] + roots[:1]
    seg = dur / len(roots); out = np.zeros_like(t)
    for i, ch in enumerate(roots):
        m = (t >= i * seg - 0.5) & (t < (i + 1) * seg + 0.5)
        env = np.clip(np.minimum((t - (i * seg - 0.5)) / 0.8, ((i + 1) * seg + 0.5 - t) / 0.8), 0, 1)
        for fq in ch:
            for det in (0.997, 1.003):
                out += m * env * np.sin(2 * np.pi * fq * det * t + rng.uniform(0, 6)) * 0.06
        out += m * env * np.sin(2 * np.pi * ch[0] / 2 * t) * 0.08
    beat = 60 / 96
    ph = (t % beat) / beat
    out += np.sin(2 * np.pi * 55 * t) * np.exp(-ph * 9) * 0.25
    hat = rng.normal(0, 1, len(t)) * np.exp(-(((t + beat / 2) % beat) / beat) * 40) * 0.03
    out += hat
    fade = np.minimum(1, np.minimum(t / 1.0, (dur - t) / 1.5))
    out = np.tanh(out * fade * 1.4) * 0.7
    pcm = (np.stack([out, np.roll(out, 300)], 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes())


OUTLETS = {'arstechnica.com': 'Ars Technica', 'wired.com': 'WIRED', 'theverge.com': 'The Verge', 'techcrunch.com': 'TechCrunch',
           'reuters.com': 'Reuters', 'bloomberg.com': 'Bloomberg', 'cnbc.com': 'CNBC', 'nytimes.com': 'The New York Times',
           'wsj.com': 'The Wall Street Journal', 'ft.com': 'Financial Times', 'technologyreview.com': 'MIT Technology Review',
           'venturebeat.com': 'VentureBeat', 'engadget.com': 'Engadget', 'axios.com': 'Axios', 'theguardian.com': 'The Guardian'}


def outlet_from_url(u):
    m = re.match(r'https?://(?:www\.)?([^/]+)', u or '')
    if not m:
        return ''
    host = m.group(1)
    return next((v for k, v in OUTLETS.items() if host == k or host.endswith('.' + k)), host)


def build(post, feed_path, out, seed=0):
    feed = Image.open(feed_path)
    photo = feed
    pts = key_points(post)
    src = clean(post.get('source') or post.get('outlet') or '') or outlet_from_url(post.get('sourceUrl', ''))
    imgs = [scene_hook(photo, feed, post)] + [scene_point(photo, i + 1, p, src) for i, p in enumerate(pts)] + [scene_end()]
    text_all = ' '.join([post['headline']] + pts)
    if BANNED.search(text_all):
        raise SystemExit('banned wording in reel text')
    tmp = tempfile.mkdtemp(prefix='reel-')
    ins, filt = [], []
    for k, (img, (_, dur)) in enumerate(zip(imgs, SCENES)):
        p = os.path.join(tmp, f's{k}.png'); img.save(p)
        ins += ['-loop', '1', '-t', str(dur), '-i', p]
        frames = int(dur * FPS)
        # slow push-in (Ken Burns) on a 2x canvas for smooth motion
        filt.append(f'[{k}:v]scale={W*2}:{H*2},zoompan=z=\'1+0.04*on/{frames}\':x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':d={frames}:s={W}x{H}:fps={FPS},setsar=1,format=yuv420p[v{k}]')
    total = sum(d for _, d in SCENES) - XF * (len(SCENES) - 1)
    last, off = 'v0', 0.0
    for k in range(1, len(SCENES)):
        off += SCENES[k - 1][1] - XF
        filt.append(f'[{last}][v{k}]xfade=transition=fade:duration={XF}:offset={off:.3f}[x{k}]')
        last = f'x{k}'
    wav = os.path.join(tmp, 'music.wav'); music(wav, total, seed)
    ins += ['-i', wav]
    cmd = ['ffmpeg', '-y', '-loglevel', 'error'] + ins + [
        '-filter_complex', ';'.join(filt), '-map', f'[{last}]', '-map', f'{len(SCENES)}:a',
        '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', str(FPS),
        '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-shortest', '-movflags', '+faststart', '-t', f'{total:.2f}', out]
    subprocess.run(cmd, check=True)
    return {'out': out, 'seconds': round(total, 2), 'points': pts}


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--post', required=True); ap.add_argument('--image', required=True)
    ap.add_argument('--out', required=True); ap.add_argument('--seed', type=int, default=0)
    a = ap.parse_args()
    print(json.dumps(build(json.load(open(a.post)), a.image, a.out, a.seed)))
