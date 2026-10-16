#!/usr/bin/env python3
"""AIFeed.run Reel builder v2: one story -> 1080x1920 H.264/AAC MP4, 17.5s, 30fps.

Timeline (120 BPM, every cut lands on a beat):
  0.0-3.5   hook: full-bleed story photo, punch-in zoom, headline lines kinetic slide-up
  3.5-14.0  3 key points x 3.5s: word-by-word captions, big index numeral, source tag
  14.0-17.5 end card: AIFeed.run logo pop, tagline, follow CTA
Segmented progress bar, IG-safe layout (text inside y 250-1480, x 80-940), aifeed.run site palette.
Audio: original 120 BPM track synthesized here with numpy (royalty-free), impact hits on every cut.
Free tools only: Python 3 + Pillow + numpy + ffmpeg.

Usage: python3 make_reel.py --post post.json --image feed.png [--photo photo.jpg|URL] --out reel.mp4
"""
import argparse, html, io, json, math, os, re, subprocess, sys, tempfile, urllib.parse, urllib.request, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1080, 1920, 30
HERE = os.path.dirname(os.path.abspath(__file__))
_fc = {}
def FONT(name, size):
    k = (name, size)
    if k not in _fc:
        _fc[k] = ImageFont.truetype(os.path.join(HERE, 'fonts', f'Poppins-{name}.ttf'), size)
    return _fc[k]

# aifeed.run site palette (index.html :root)
BG = (9, 8, 26); PURPLE = (124, 58, 237); ORANGE = (249, 115, 22); GREEN = (34, 197, 94)
WHITE = (255, 255, 255); MUTED = (190, 188, 215); PINK = (255, 46, 136)  # hot pink headline accent
SAFE_X0, SAFE_X1, SAFE_TOP, SAFE_BOTTOM = 80, 940, 250, 1480  # IG Reels UI: keep top 250px, bottom 440px, right 140px clear
# Category pill colors: (background, text). Keys are lower-case categories. Hot pink is the fallback / general (Industry, AI News).
# Override without code changes: AIFEED_PILL_COLORS='{"business": ["#1D4ED8", "#FFFFFF"]}' (JSON, merged over these).
PILL_COLORS = {
    'business': ('#2563EB', '#FFFFFF'),        # blue
    'research': ('#16A34A', '#FFFFFF'),        # green
    'policy': ('#7C3AED', '#FFFFFF'),          # purple
    'products': ('#F59E0B', '#111111'),        # amber
    'product': ('#F59E0B', '#111111'), 'launch': ('#F59E0B', '#111111'),
    'funding': ('#0D9488', '#FFFFFF'),         # teal
    'safety': ('#DC2626', '#FFFFFF'),          # red
    'tools': ('#06B6D4', '#0B1120'),           # cyan
    'models': ('#A3E635', '#111111'),          # lime
    'hardware': ('#475569', '#FFFFFF'),        # steel
    'infrastructure': ('#EA580C', '#FFFFFF'),  # orange
    'health': ('#34D399', '#0B1120'),          # mint
    'security': ('#991B1B', '#FFFFFF'),        # deep crimson
}
PILL_DEFAULT = ('#FF2E88', '#FFFFFF')          # hot pink (brand)


def _hex(c):
    c = c.lstrip('#'); return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def pill_colors(category):
    m = dict(PILL_COLORS)
    try:
        m.update({k.lower(): tuple(v) for k, v in json.loads(os.environ.get('AIFEED_PILL_COLORS') or '{}').items()})
    except ValueError:
        print('AIFEED_PILL_COLORS is not valid JSON; using defaults', file=sys.stderr)
    bg, fg = m.get((category or '').strip().lower(), PILL_DEFAULT)
    return _hex(bg), _hex(fg)


BANNED = re.compile(r'\b(daily|hand[- ]?edited|human[- ]?edited|edited by (a )?human|our editors?)\b', re.I)

BEAT = 0.5
SCENES = [('hook', 3.5), ('p1', 3.5), ('p2', 3.5), ('p3', 3.5), ('end', 3.5)]
TOTAL = sum(d for _, d in SCENES)
CUTS = np.cumsum([0] + [d for _, d in SCENES])[:-1].tolist()  # 0, 3.5, 7, 10.5, 14
MAXPT = 118  # max characters per key point


# ---------- text selection ----------
def clean(s):
    s = html.unescape(re.sub(r'<[^>]+>', ' ', s or ''))
    return re.sub(r'\s+', ' ', s).strip()


def sentences(text):
    # split on sentence ends, but not after abbreviations like U.S., U.K., Mr., Dr., Inc.
    text = re.sub(r'\b([A-Z])\.(?=[A-Z]\.)', r'\1<DOT>', text)
    text = re.sub(r'(<DOT>[A-Z])\.', r'\1<DOT>', text)
    text = re.sub(r'\b(U\.S|U\.K|U\.N|E\.U|Mr|Ms|Mrs|Dr|Inc|Corp|Jr|Sr|St|vs)\.', lambda m: m.group(1).replace('.', '<DOT>') + '<DOT>', text)
    parts = re.split(r'(?<=[.!?])\s+(?=[A-Z"\u201c])', text)
    return [x.replace('<DOT>', '.').strip() for x in parts if len(x.strip()) > 25]


LEADS = re.compile(r'^(however|meanwhile|additionally|also|still|instead|in addition|notably|moreover|for example),?\s+', re.I)


CLAUSE = re.compile(r'(?:,\s(?=(?:which|while|after|as|because|amid|noting|saying|according|contrasting|including|but|where|who|marking|making|adding|citing)\b)'
                    r'|\s[\u2014\u2013]\s|;\s|:\s|\s(?=(?:while|after|because|amid|according to|contrasting with|including)\s))')


def tighten(s, n=MAXPT):
    """Shorten to <= n chars by keeping the source's own leading clause (no invented words, no ellipsis).
    Only cuts at clause boundaries (never inside a list or before a dangling word); returns None if it can't."""
    s = LEADS.sub('', s).strip()
    s = s[0].upper() + s[1:] if s else s
    if len(s) <= n:
        return s
    best = None
    for m in CLAUSE.finditer(s):
        cut = s[:m.start()].rstrip(' ,;:')
        if 45 <= len(cut) <= n and len(cut.split()) >= 7 and cut.count(',') < 2:
            best = cut
    return best.rstrip('.') + '.' if best else None


def key_points(post):
    paras = [clean(p) for p in re.findall(r'<p>(.*?)</p>', post.get('body', ''), re.S)] or [clean(post.get('body', ''))]
    head = set(re.findall(r'[a-z0-9]{4,}', clean(post.get('headline', '')).lower()))
    cands = sentences(clean(post.get('summary', ''))) + [s for p in paras for s in sentences(p)]
    pool, seen = [], [head] if head else []
    # sentences that open with a bare pronoun lack a referent on screen; use them only as a last resort
    pron = re.compile(r'^(he|she|it|they|this|that|these|those|his|her|its|their)\b', re.I)
    cands = [c for c in cands if not pron.match(c)] + [c for c in cands if pron.match(c)]
    for s in cands:
        if BANNED.search(s):
            continue
        t = tighten(s)
        if not t:
            continue
        words = set(re.findall(r'[a-z0-9]{4,}', t.lower()))
        if any(len(words & o) / max(1, min(len(words), len(o))) > 0.5 for o in seen):
            continue
        seen.append(words); pool.append(t)
        if len(pool) == 3:
            break
    while len(pool) < 3:
        pool.append('Full story at aifeed.run.')
    return pool


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


# ---------- drawing helpers ----------
def ease_out(t): t = min(max(t, 0), 1); return 1 - (1 - t) ** 3
def ease_back(t): t = min(max(t, 0), 1); c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2


def wrap(text, font, maxw):
    d = ImageDraw.Draw(Image.new('L', (1, 1)))
    lines, cur = [], ''
    for w in text.split():
        t = (cur + ' ' + w).strip()
        if d.textlength(t, font=font) <= maxw:
            cur = t
        else:
            if cur: lines.append(cur)
            cur = w
    if cur: lines.append(cur)
    return lines


def fit(text, name, maxw, maxh, start, minsize=44, lh=1.12):
    for size in range(start, minsize - 1, -4):
        f = FONT(name, size); lines = wrap(text, f, maxw)
        if int(size * lh) * len(lines) <= maxh:
            return f, lines, int(size * lh)
    f = FONT(name, minsize); return f, wrap(text, f, maxw), int(minsize * lh)


def text_sprite(text, font, fill, shadow=True):
    d = ImageDraw.Draw(Image.new('L', (1, 1)))
    l, t, r, b = d.textbbox((0, 0), text, font=font)
    pad = 24
    im = Image.new('RGBA', (r - l + pad * 2, b - t + pad * 2), (0, 0, 0, 0))
    if shadow:
        sh = Image.new('RGBA', im.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh).text((pad - l, pad - t + 4), text, font=font, fill=(0, 0, 0, 170))
        im = Image.alpha_composite(im, sh.filter(ImageFilter.GaussianBlur(8)))
    ImageDraw.Draw(im).text((pad - l, pad - t), text, font=font, fill=fill)
    return im, pad - l, pad - t


def paste_alpha(base, spr, x, y, alpha=1.0, scale=1.0):
    if alpha <= 0: return
    if scale != 1.0:
        w, h = spr.size
        spr = spr.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.BILINEAR)
        x += (w - spr.width) / 2; y += (h - spr.height) / 2
    if alpha < 1:
        a = spr.getchannel('A').point(lambda v: int(v * alpha)); spr = spr.copy(); spr.putalpha(a)
    base.alpha_composite(spr, (int(x), int(y)))


def cover(img, w, h):
    s = max(w / img.width, h / img.height)
    im = img.resize((math.ceil(img.width * s), math.ceil(img.height * s)), Image.LANCZOS)
    l, t = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((l, t, l + w, t + h))


def vgrad(h, stops):
    """vertical alpha gradient (list of (pos, alpha))"""
    ys = np.linspace(0, 1, h); a = np.interp(ys, [p for p, _ in stops], [v for _, v in stops])
    return a


def shade(img, stops, color=BG):
    arr = np.asarray(img.convert('RGB')).astype(np.float32)
    a = vgrad(img.height, stops)[:, None, None]
    arr = arr * (1 - a) + np.array(color, np.float32) * a
    return Image.fromarray(arr.clip(0, 255).astype('uint8'))


def trim_bars(img, thr=18, frac=.97):
    """Remove baked-in letterbox/pillarbox bars (near-black or near-white rows/cols) so the scene is truly full-bleed."""
    a = np.asarray(img.convert('L')).astype(np.int16)
    def keep(m):
        return ~(((m < thr).mean(1) > frac) | ((m > 255 - thr).mean(1) > frac))
    r, c = np.where(keep(a))[0], np.where(keep(a.T))[0]
    if len(r) < a.shape[0] * .5 or len(c) < a.shape[1] * .5:
        return img
    return img.crop((int(c[0]), int(r[0]), int(c[-1]) + 1, int(r[-1]) + 1))


def is_photo(img):
    """Reject flat gradients / text cards: a real photo has fine detail (edge energy) across the frame."""
    g = np.asarray(img.convert('L').resize((270, 480))).astype(np.float32)
    return float(np.abs(np.diff(g, axis=1)).mean() + np.abs(np.diff(g, axis=0)).mean()) > 4.0


def vignette(img, strength=.55):
    yy, xx = np.mgrid[0:img.height, 0:img.width].astype(np.float32)
    r = np.sqrt(((xx - img.width / 2) / (img.width / 2)) ** 2 + ((yy - img.height / 2) / (img.height / 2)) ** 2) / 1.42
    k = 1 - strength * np.clip(r, 0, 1) ** 2.2
    arr = np.asarray(img.convert('RGB')).astype(np.float32) * k[..., None]
    return Image.fromarray(arr.clip(0, 255).astype('uint8'))


def grade(img):
    """Newsroom grade: slight desaturation + contrast so any source photo reads cinematic under white/pink type."""
    from PIL import ImageEnhance
    img = ImageEnhance.Color(img).enhance(.82)
    return ImageEnhance.Contrast(img).enhance(1.12)


# ---------- scenes ----------
class Reel:
    def __init__(self, post, feed, photo, src, credit=''):
        self.post, self.src = post, src
        self.credit = text_sprite(re.sub(r'\s*\(https?://\S+\)$', '', credit), FONT('Regular', 24), MUTED, shadow=True) if credit else None
        self.points = key_points(post)
        self.headline = clean(post['headline'])
        text_all = ' '.join([self.headline] + self.points)
        if BANNED.search(text_all):
            raise SystemExit('banned wording in reel text')
        ph = grade(trim_bars(photo.convert('RGB')))
        big = cover(ph, int(W * 1.22), int(H * 1.22))
        dark = vignette(Image.blend(big, Image.new('RGB', big.size, (0, 0, 0)), .42))  # heavy overlay
        self.hook_bg = shade(dark, [(0, .6), (.18, .35), (.38, .4), (.55, .82), (.72, .93), (1, .97)], (0, 0, 0))
        self.pt_bg = shade(vignette(Image.blend(big, Image.new('RGB', big.size, (0, 0, 0)), .6)), [(0, .5), (.3, .45), (.7, .55), (1, .7)], (0, 0, 0))
        # category pill
        cat = (post.get('category') or 'AI News').upper()
        f = FONT('Bold', 34); tw = int(ImageDraw.Draw(Image.new('L', (1, 1))).textlength(cat, font=f))
        self.pill = Image.new('RGBA', (tw + 56, 64), (0, 0, 0, 0))
        dp = ImageDraw.Draw(self.pill); pbg, pfg = pill_colors(post.get('category'))
        dp.rounded_rectangle((0, 0, tw + 55, 63), 32, fill=pbg + (255,))
        dp.text(((tw + 56) / 2, 33), cat, font=f, fill=pfg, anchor='mm')
        # headline lines
        hf, hl, hlh = fit(self.headline.upper(), 'Bold', SAFE_X1 - SAFE_X0, 560, 112, 64, 1.04)
        npink = max(1, round(len(hl) * .4)) if len(hl) > 1 else 0
        self.h_lines = [text_sprite(l, hf, PINK if i >= len(hl) - npink else WHITE) for i, l in enumerate(hl)]; self.h_lh = hlh
        self.h_y0 = SAFE_BOTTOM - 110 - hlh * len(hl)
        # points
        self.p_words = []
        for p in self.points:
            pf, pl, plh = fit(p, 'Bold', SAFE_X1 - SAFE_X0, 760, 100, 60, 1.12)
            items, k = [], 0
            y0 = 620 + max(0, (760 - plh * len(pl)) // 3)
            for li, line in enumerate(pl):
                x = SAFE_X0
                for w in line.split():
                    spr = text_sprite(w, pf, WHITE)
                    items.append((spr, x, y0 + li * plh, k)); k += 1
                    x += ImageDraw.Draw(Image.new('L', (1, 1))).textlength(w + ' ', font=pf)
            self.p_words.append(items)
        self.num = [text_sprite(f'0{i + 1}', FONT('Bold', 190), PINK, shadow=False) for i in range(3)]
        self.src_spr = text_sprite(('Source: ' + src) if src else 'aifeed.run', FONT('SemiBold', 38), MUTED, shadow=False)
        self.brand = self._brand(54, shadow=True)
        self.end_logo = self._brand(150, shadow=True)
        self.tag = text_sprite('The AI news that matters.', FONT('Regular', 56), WHITE, shadow=False)
        self.cta = self._cta()
        self.web = text_sprite('Free newsletter at aifeed.run', FONT('Regular', 40), MUTED, shadow=False)
        self.end_bg = self._end_bg(big)

    def _brand(self, size, shadow=False):
        f = FONT('Bold', size)
        a, ax, ay = text_sprite('AIFeed', f, WHITE, shadow); b, bx, by = text_sprite('.run', f, ORANGE, shadow)
        d = ImageDraw.Draw(Image.new('L', (1, 1))); wa = d.textlength('AIFeed', font=f)
        im = Image.new('RGBA', (int(wa) + b.width, max(a.height, b.height)), (0, 0, 0, 0))
        im.alpha_composite(a, (0, 0)); im.alpha_composite(b, (int(wa) + ax - bx, ay - by))
        return im

    def _cta(self):
        im = Image.new('RGBA', (640, 112), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
        d.rounded_rectangle((0, 0, 639, 111), 56, fill=PURPLE + (255,))
        d.text((320, 57), 'Follow @aifeed.run', font=FONT('Bold', 46), fill=WHITE, anchor='mm')
        return im

    def _end_bg(self, big):
        """End card stays photo-first: the story photo, blurred and crushed dark, with a faint brand glow."""
        ph = cover(big, W, H).filter(ImageFilter.GaussianBlur(28))
        ph = vignette(Image.blend(ph, Image.new('RGB', (W, H), (0, 0, 0)), .72), .6)
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        r1 = np.sqrt((xx - W * .5) ** 2 + (yy - 760) ** 2) / 900
        r2 = np.sqrt((xx - W * .85) ** 2 + (yy - 1300) ** 2) / 700
        g = np.clip(1 - r1, 0, 1)[..., None] ** 2 * np.array(PURPLE, np.float32) * .55
        g += np.clip(1 - r2, 0, 1)[..., None] ** 2 * np.array(ORANGE, np.float32) * .25
        return Image.fromarray((np.asarray(ph).astype(np.float32) + g * .6).clip(0, 255).astype('uint8'))

    def progress(self, fr, t):
        d = ImageDraw.Draw(fr)
        n = len(SCENES); gap = 10; w = (SAFE_X1 + 60 - SAFE_X0 - gap * (n - 1)) / n
        for i, (c, (_, dur)) in enumerate(zip(CUTS, SCENES)):
            x0 = SAFE_X0 + i * (w + gap); fill = min(max((t - c) / dur, 0), 1)
            d.rounded_rectangle((x0, 196, x0 + w, 204), 4, fill=(255, 255, 255, 70))
            if fill > 0:
                d.rounded_rectangle((x0, 196, x0 + max(8, w * fill), 204), 4, fill=WHITE + (255,))

    def zoom_crop(self, img, z, cx=.5, cy=.5):
        """z=1 shows the whole (oversized) image; larger z punches in."""
        cw, ch = img.width / z, img.height / z
        x0 = (img.width - cw) * cx; y0 = (img.height - ch) * cy
        return img.crop((int(x0), int(y0), int(x0 + cw), int(y0 + ch))).resize((W, H), Image.BILINEAR)

    def logo(self, fr, a=1.0):
        paste_alpha(fr, self.brand, SAFE_X1 + 20 - self.brand.width, SAFE_BOTTOM + 8, a)  # bottom-right, inside safe zone

    def draw_cover_text(self, fr, lt):
        pt = ease_out((lt - .05) / .25); paste_alpha(fr, self.pill, SAFE_X0 - 30 * (1 - pt), SAFE_TOP + 40, pt)
        for i, (spr, ox, oy) in enumerate(self.h_lines):
            p = ease_out((lt - .1 - i * .1) / .32)
            paste_alpha(fr, spr, SAFE_X0 - ox, self.h_y0 + i * self.h_lh - oy + 60 * (1 - p), p)
        sw = ease_out((lt - .5) / .5)
        if sw > 0:
            y = self.h_y0 + len(self.h_lines) * self.h_lh + 26
            ImageDraw.Draw(fr).rectangle((SAFE_X0, y, SAFE_X0 + 220 * sw, y + 10), fill=PINK)
        self.logo(fr, ease_out((lt - .3) / .3))
        if self.credit:  # CC BY / BY-SA attribution on the frames that show the photo full-bleed
            spr, ox, oy = self.credit; paste_alpha(fr, spr, SAFE_X0 - ox, SAFE_BOTTOM + 90 - oy, .85)

    def cover(self):
        """IG grid cover (cover_url): the fully revealed opening frame, no progress bar."""
        fr = self.zoom_crop(self.hook_bg, 1.04, .5, .4).convert('RGBA'); self.draw_cover_text(fr, 5)
        return fr.convert('RGB')

    def frame(self, t):
        si = max(i for i, c in enumerate(CUTS) if t >= c - 1e-6); lt = t - CUTS[si]; name = SCENES[si][0]
        if name == 'hook':
            z = 1.04 + 0.22 * (1 - ease_out(lt / 1.2)) + 0.06 * lt / 3.5
            fr = self.zoom_crop(self.hook_bg, z, .5, .4).convert('RGBA')
            self.draw_cover_text(fr, lt)
        elif name.startswith('p'):
            k = int(name[1]) - 1
            z = 1.0 + .06 * lt / 3.5
            fr = self.zoom_crop(self.pt_bg, z, (.2, .8, .5)[k], (.3, .6, .45)[k]).convert('RGBA')  # new framing per point
            self.logo(fr)
            spr, ox, oy = self.num[k]; p = ease_back(lt / .35)
            paste_alpha(fr, spr, SAFE_X0 - ox, 340 - oy, min(1, lt / .2), .6 + .4 * p)
            ImageDraw.Draw(fr).rectangle((SAFE_X0, 572, SAFE_X0 + 160 * ease_out(lt / .4), 582), fill=PINK)
            words = self.p_words[k]; per = min(.09, 1.5 / max(1, len(words)))
            for (s, x, y, i) in words:
                wt = (lt - .25 - i * per) / .18
                if wt <= 0: continue
                paste_alpha(fr, s[0], x - s[1], y - s[2] + 22 * (1 - ease_out(wt)), ease_out(wt), .92 + .08 * ease_back(wt))
            s, ox, oy = self.src_spr
            paste_alpha(fr, s, SAFE_X0 - ox, SAFE_BOTTOM - 70 - oy, ease_out((lt - .6) / .3))
        else:
            fr = self.end_bg.copy().convert('RGBA')  # end card: logo is the hero, no corner mark
            p = ease_back(lt / .45)
            lg = self.end_logo; paste_alpha(fr, lg, (W - lg.width) / 2, 640, min(1, lt / .2), .7 + .3 * p)
            s, ox, oy = self.tag; tp = ease_out((lt - .35) / .35)
            paste_alpha(fr, s, (W - s.width) / 2, 860 + 30 * (1 - tp), tp)
            cp = ease_back((lt - .6) / .4); paste_alpha(fr, self.cta, (W - 640) / 2, 1010 + 40 * (1 - min(cp, 1)), ease_out((lt - .6) / .25))
            s, ox, oy = self.web; paste_alpha(fr, s, (W - s.width) / 2, 1160, ease_out((lt - .9) / .3))
        self.progress(fr, t)
        # cut punch: brief flash + scale-in on scene entry
        if si > 0 and lt < .2:
            f = 1 - lt / .2
            sc = 1 + .05 * f
            fr = fr.resize((int(W * sc), int(H * sc)), Image.BILINEAR).crop((int((W * sc - W) / 2), int((H * sc - H) / 2), int((W * sc - W) / 2) + W, int((H * sc - H) / 2) + H))
            fr = Image.blend(fr, Image.new('RGBA', (W, H), WHITE + (255,)), .28 * f ** 2)
        return fr.convert('RGB')


# ---------- audio ----------
def music(path, dur, seed=0):
    """Original 120 BPM track: kick/hat/bass/pad + impacts on every cut (all synthesized here)."""
    sr = 44100; n = int(sr * dur); t = np.arange(n) / sr; out = np.zeros(n)
    rng = np.random.default_rng(seed)
    prog = [(110.0, [220, 261.63, 329.63]), (87.31, [174.61, 220, 261.63]), (130.81, [261.63, 329.63, 392]), (98.0, [196, 246.94, 293.66])]
    if seed % 2: prog = prog[2:] + prog[:2]
    bar = BEAT * 4
    for i in range(int(dur / bar) + 1):
        root, ch = prog[i % 4]; s, e = i * bar, (i + 1) * bar
        m = (t >= s) & (t < e); lt = t[m] - s
        for fq in ch:
            out[m] += 0.035 * (np.sin(2 * np.pi * fq * t[m]) + .5 * np.sin(2 * np.pi * fq * 2.003 * t[m])) * np.minimum(1, lt / .05)
        for b8 in range(8):  # 8th-note bass
            bs = s + b8 * BEAT / 2; mm = (t >= bs) & (t < bs + BEAT / 2); bl = t[mm] - bs
            out[mm] += 0.16 * np.tanh(3 * np.sin(2 * np.pi * root * t[mm])) * np.exp(-bl * 7)
    for k in range(int(dur / BEAT) + 1):  # kick + offbeat hat
        ks = k * BEAT; mm = (t >= ks) & (t < ks + .35); kl = t[mm] - ks
        out[mm] += 0.5 * np.sin(2 * np.pi * (50 + 120 * np.exp(-kl * 30)) * kl) * np.exp(-kl * 9)
        hs = ks + BEAT / 2; mm = (t >= hs) & (t < hs + .06); hl = t[mm] - hs
        out[mm] += 0.06 * rng.normal(0, 1, mm.sum()) * np.exp(-hl * 60)
    for c in CUTS[1:]:  # impact + reverse-swell riser into each cut
        mm = (t >= c) & (t < c + .8); il = t[mm] - c
        out[mm] += 0.45 * np.sin(2 * np.pi * (40 + 60 * np.exp(-il * 12)) * il) * np.exp(-il * 5)
        out[mm] += 0.10 * rng.normal(0, 1, mm.sum()) * np.exp(-il * 14)
        mm = (t >= c - .5) & (t < c); rl = (t[mm] - (c - .5)) / .5
        out[mm] += 0.07 * rng.normal(0, 1, mm.sum()) * rl ** 3
    fade = np.minimum(1, np.minimum(t / .05, (dur - t) / 1.2))
    out = np.tanh(out * fade * 1.1) * .8
    st = np.stack([out, np.roll(out, 220)], 1)
    with wave.open(path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes((st * 32767).astype('<i2').tobytes())


FALLBACK_QUERIES = {
    'business': ['stock exchange trading floor', 'datacenter servers'], 'finance': ['stock exchange trading floor'],
    'policy': ['United States Capitol night'], 'research': ['laboratory scientist computer'], 'tools': ['laptop code screen dark'],
    'hardware': ['datacenter servers', 'computer chip wafer'], 'default': ['datacenter servers', 'server room']}
FREE_LICENSES = re.compile(r'^(CC0|Public domain|CC BY(-SA)? [0-9.]+|No restrictions)$', re.I)


def commons_photo(category, used=()):
    """Photorealistic fallback from Wikimedia Commons (CC0/PD/CC BY/CC BY-SA). Returns (PIL image, credit) or (None, '')."""
    ua = {'User-Agent': 'aifeed-reels/1.0 (https://aifeed.run)'}
    for q in FALLBACK_QUERIES.get((category or '').lower(), []) + FALLBACK_QUERIES['default']:
        u = ('https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=15'
             '&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1600&gsrsearch=' + urllib.parse.quote(q + ' filetype:bitmap'))
        try:
            pages = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=ua), timeout=20)).get('query', {}).get('pages', {})
        except Exception as e:
            print('commons search failed:', e, file=sys.stderr); continue
        for pg in sorted(pages.values(), key=lambda p: p.get('index', 99)):
            ii = (pg.get('imageinfo') or [{}])[0]; m = ii.get('extmetadata', {})
            lic = clean(m.get('LicenseShortName', {}).get('value', ''))
            if not FREE_LICENSES.match(lic) or ii.get('width', 0) < 1200 or pg['title'] in used:
                continue
            if not re.search(r'\.(jpe?g)$', pg['title'], re.I):
                continue
            try:
                img = Image.open(io.BytesIO(urllib.request.urlopen(urllib.request.Request(ii['thumburl'], headers=ua), timeout=30).read()))
            except Exception:
                continue
            artist = clean(m.get('Artist', {}).get('value', '')) or 'Wikimedia Commons'
            return img, f"Photo: {artist[:60]} / {lic} via Wikimedia Commons ({ii.get('descriptionurl', '')})"
    return None, ''


def load_photo(photo, feed, category=''):
    if photo:
        try:
            if re.match(r'https?://', photo):
                req = urllib.request.Request(photo, headers={'User-Agent': 'Mozilla/5.0 (aifeed.run reels)'})
                img = Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=30).read()))
            else:
                img = Image.open(photo)
            img.load()
            if min(img.size) >= 400 and is_photo(img):
                return img, ''
            print('photo too small or not photographic, trying Commons fallback', file=sys.stderr)
        except Exception as e:
            print('photo load failed, trying Commons fallback:', e, file=sys.stderr)
    img, credit = commons_photo(category)
    if img is not None:
        return img, credit
    crop = feed.convert('RGB').crop((0, 130, feed.width, int(feed.height * .53)))  # photo area of the feed graphic
    if is_photo(crop):
        return crop, ''
    raise SystemExit('no real photo for this story (feed graphic is a text/gradient card); refusing a text-only Reel')


def build(post, feed_path, out, seed=0, photo=None):
    feed = Image.open(feed_path)
    src = clean(post.get('source') or post.get('outlet') or '') or outlet_from_url(post.get('sourceUrl', ''))
    img, credit = load_photo(photo or post.get('photoUrl'), feed, post.get('category', ''))
    r = Reel(post, feed, img, src, credit)
    cover_path = os.path.splitext(out)[0] + '_cover.jpg'
    r.cover().save(cover_path, quality=92)
    tmp = tempfile.mkdtemp(prefix='reel-'); wav = os.path.join(tmp, 'music.wav'); music(wav, TOTAL, seed)
    p = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                          '-i', wav, '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
                          '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-shortest', '-movflags', '+faststart', out], stdin=subprocess.PIPE)
    for i in range(int(TOTAL * FPS)):
        p.stdin.write(r.frame(i / FPS).tobytes())
    p.stdin.close()
    if p.wait() != 0:
        raise SystemExit('ffmpeg failed')
    return {'out': out, 'cover': cover_path, 'seconds': TOTAL, 'points': r.points, 'photoCredit': credit}


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--post', required=True); ap.add_argument('--image', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--photo', default=''); ap.add_argument('--seed', type=int, default=0)
    a = ap.parse_args()
    print(json.dumps(build(json.load(open(a.post)), a.image, a.out, a.seed, a.photo or None)))
