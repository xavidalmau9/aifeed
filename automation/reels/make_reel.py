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
import argparse, html, io, json, math, os, re, shutil, subprocess, sys, tempfile, urllib.parse, urllib.request, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1080, 1920, 30
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)  # sibling modules: scenes, voice
_fc = {}
def FONT(name, size):
    k = (name, size)
    if k not in _fc:
        fn = 'Anton-Regular.ttf' if name == 'Anton' else f'Poppins-{name}.ttf'  # Anton: free Google Font (OFL), condensed poster headline
        _fc[k] = ImageFont.truetype(os.path.join(HERE, 'fonts', fn), size)
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
    'hardware': ('#FDE047', '#111111'),        # electric yellow (was steel #475569: too dull/dark as an accent)
    'infrastructure': ('#EA580C', '#FFFFFF'),  # orange
    'health': ('#34D399', '#0B1120'),          # mint
    'security': ('#991B1B', '#FFFFFF'),        # deep crimson
}
PILL_DEFAULT = ('#FF2E88', '#FFFFFF')          # hot pink (brand)


def _hex(c):
    c = c.lstrip('#'); return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def _lum(c):
    def ch(v):
        v /= 255; return v / 12.92 if v <= .03928 else ((v + .055) / 1.055) ** 2.4
    return .2126 * ch(c[0]) + .7152 * ch(c[1]) + .0722 * ch(c[2])


def contrast(a, b):
    la, lb = sorted((_lum(a), _lum(b)), reverse=True); return (la + .05) / (lb + .05)


def readable(c, on=(12, 12, 16), ratio=4.5):
    """Same hue, lightened toward white until WCAG contrast vs the dark overlay is >= ratio (text use)."""
    c = tuple(c); k = 0.0
    while contrast(c, on) < ratio and k < 1:
        k += .05; c = tuple(int(round(v + (255 - v) * .05)) for v in c)
    return c


def accent_color(category):
    """Story accent = the category pill color (hot pink fallback), made readable as text on dark photos."""
    return readable(pill_colors(category)[0])


def pill_colors(category):
    m = dict(PILL_COLORS)
    try:
        m.update({k.lower(): tuple(v) for k, v in json.loads(os.environ.get('AIFEED_PILL_COLORS') or '{}').items()})
    except ValueError:
        print('AIFEED_PILL_COLORS is not valid JSON; using defaults', file=sys.stderr)
    bg, fg = m.get((category or '').strip().lower(), PILL_DEFAULT)
    return _hex(bg), _hex(fg)


# ---------- v3 template (opt-in: AIFEED_REEL_TEMPLATE=v3) ----------
# v3 = retention cut: payoff headline on screen at frame 0, voice starts on the hook, 7-10s, save/share/follow end card.
# AIFEED_HOOK_STYLE (v3 only): A = bold claim, B = question, C = 'what this means for you'; unset/off = the normal punch.
V3_MIN_S, V3_MAX_S, V3_END_HOLD = 7.0, 10.0, 3.5  # end card holds ~3.5 s (takeaway / share / follow)
FOLLOW_LINE = 'Follow @aifeed.run for the AI news that matters'
# Targeted share prompt per category (same keys as PILL_COLORS); SHARE_DEFAULT for anything else.
SHARE_PROMPTS = {
    'business': 'Send this to the person who runs your budget',
    'research': 'Send this to the friend who reads the papers',
    'policy': 'Send this to someone who follows AI rules',
    'products': 'Send this to the friend who tries every new app',
    'product': 'Send this to the friend who tries every new app',
    'launch': 'Send this to the friend who tries every new app',
    'funding': 'Send this to your startup friend',
    'safety': 'Send this to your IT person',
    'tools': 'Send this to the teammate who automates everything',
    'models': 'Send this to the friend who tests every model',
    'hardware': 'Send this to your PC-building friend',
    'infrastructure': 'Send this to your cloud or ops lead',
    'health': 'Send this to someone in healthcare',
    'security': 'Send this to your IT person',
}
SHARE_DEFAULT = 'Send this to someone who needs to know'


def reel_template():
    return 'v3' if os.environ.get('AIFEED_REEL_TEMPLATE', '').strip().lower() == 'v3' else 'v2'


def hook_style():
    s = os.environ.get('AIFEED_HOOK_STYLE', '').strip().upper()
    return s if s in ('A', 'B', 'C') else ''


def share_prompt(category):
    return SHARE_PROMPTS.get((category or '').strip().lower(), SHARE_DEFAULT)


def valid_hook(p, style):
    """A hook variant in punch format: 2-4 lines split by '/', exactly one '*' accent line, <= 22 chars a line, no banned
    words; B must be a question, A/C must not be. (YOU/YOUR openers are allowed here: C speaks to the viewer.)"""
    if not isinstance(p, str):
        return False
    lines = [l.strip() for l in p.split('/') if l.strip()]
    ok = 2 <= len(lines) <= 4 and sum(l.startswith('*') for l in lines) == 1 and all(len(l.lstrip('*')) <= 22 for l in lines)
    q = p.rstrip().endswith('?')
    return bool(ok and not BANNED.search(p) and (q if style == 'B' else not q))


def pick_hook(post, style):
    """-> (punch to use, style actually used). Hooks come from the Reel brief (post['hooks'] = {A, B, C}); a missing or
    invalid variant falls back to the normal punch (style '' = fallback) so a Reel is never blocked."""
    if not style:
        return post.get('punch'), ''
    h = (post.get('hooks') or {}).get(style)
    if valid_hook(h, style):
        return h.upper(), style
    return post.get('punch'), ''


def takeaway_text(post, n=95):
    t = clean(post.get('takeaway') or '')
    if not t or len(t) > n or BANNED.search(t):
        t = next((x for x in key_points(post, n) if x != 'Full story at aifeed.run.'), clean(post.get('summary', ''))[:n])
    return t


BANNED = re.compile(r'\b(daily|hand[- ]?edited|human[- ]?edited|edited by (a )?human|our editors?)\b', re.I)

BEAT = 0.5
SCENES = [('hook', 3.5), ('p1', 3.5), ('p2', 3.5), ('p3', 3.5), ('end', 3.5)]
TOTAL = sum(d for _, d in SCENES)
CUTS = np.cumsum([0] + [d for _, d in SCENES])[:-1].tolist()  # 0, 3.5, 7, 10.5, 14
MAXPT = 118  # max characters per key point
MIN_S, MAX_S = 12.0, 18.0  # voiceover timeline length bounds


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


def key_points(post, n=MAXPT):
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
        t = tighten(s, n)
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


STOP = set('the a an and or but of to in on for with by at from as is are was were be been being it its this that these those their '
           'they he she his her we our you your will would can could has have had not new into over than then also more most about '
           'after before while says said say company firm'.split())
# a point that leans on something the viewer never heard ("these challenges", "the move", a bare pronoun) is skipped
DANGLING = re.compile(r'^(?:it|they|this|that|these|those|he|she|his|her|its|their|such|the move|the deal|the decision|the company|the firm|'
                      r'the report|the study|the effort|the plan|the change|the news)\b'
                      r'|\b(?:these|those|such|this|that)\s+(?:challenges?|issues?|problems?|moves?|efforts?|changes?|plans?|concerns?|'
                      r'developments?|steps?|findings?|claims?|questions?|risks?|measures?|limits?|arrangements?)\b'
                      r'|^(?:when|while|if|as|because|although|though|but|and|so)\b', re.I)


def _stems(t):
    return {w[:5] for w in re.findall(r"[a-z0-9]+", t.lower().replace("\u2019", "'")) if w not in STOP and len(w) > 2}


def voice_points(post, n=150, max_points=6, story=False):
    """Points for the voiceover: self-contained sentences, each adding something the headline and earlier points didn't.
    story=True (story-only voice, headline not spoken): the lead sentence that restates the headline is kept - it's the
    'what happened' opener."""
    paras = [clean(p) for p in re.findall(r'<p>(.*?)</p>', post.get('body', ''), re.S)] or [clean(post.get('body', ''))]
    head = clean(post.get('headline', '')); hs = _stems(head)
    seen, out = [], []
    for c in sentences(clean(post.get('summary', ''))) + [x for p in paras for x in sentences(p)]:
        if BANNED.search(c):
            continue
        t = tighten(c, n)
        if not t or DANGLING.search(t) or len(t.split()) < 6:
            continue
        m = re.search(DEFINITE, t, re.I)
        if m and m.group(1).lower() not in head.lower():
            continue  # "the bill" / "the deal" the viewer was never told about
        st = _stems(t)
        if not st or (not story and (len(st & hs) >= 3 or len(st & hs) / len(st) > .4)):
            continue  # restates the headline (the voice just said it)
        if any(len(st & o) >= 3 or len(st & o) / max(1, min(len(st), len(o))) > .4 for o in seen):
            continue  # near-duplicate of an earlier point
        seen.append(st); out.append(t)
        if len(out) == max_points:
            break
    return out


DEFINITE = r'\bthe (bill|deal|move|plan|agreement|proposal|report|study|decision|lawsuit|case|ruling|policy|program|update)\b'


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


# ---------- punch headline ----------
COVER_X0, COVER_X1 = 80, 1000           # cover text column (IG 3:4 grid crop is x 0-1080, y 240-1680)
GRID_TOP, GRID_BOTTOM = 240, 1680       # everything on the cover must sit inside this band
PUNCH_TOP, PUNCH_BOTTOM = 900, 1520     # headline block: roughly the bottom half of the 3:4 tile
DOCK_TOP, DOCK_BOTTOM = 820, 1110       # docked (smaller) headline while the voiceover reads the points
HOOK_CAP_TOP = 560  # story mode: captions above the big opening headline (below the pill, inside the 3:4 band)
CAP_X0, CAP_X1, CAP_TOP, CAP_SIZE = 80, 940, 1170, 86  # captions: below the docked headline, above the logo, clear of IG's right rail
END_FADE, PUSH = .18, .09               # end-card dissolve (s, lands on the outro's first word); total slow push-in


def punch_lines(post, headline):
    """Short poster headline as 3-4 lines. post['punch'] = 'COREWEAVE / CREDIT STRESS / HITS DISTRESS LEVELS';
    prefix one line with '*' to make it the pink line. Otherwise split the headline into balanced lines."""
    raw = clean(post.get('punch') or post.get('punchHeadline') or '')
    if raw:
        lines = [l.strip() for l in raw.split('/') if l.strip()]
    else:
        words = headline.split(); n = 3 if len(headline) <= 42 else 4 if len(headline) <= 64 else 5
        target = len(headline) / n; lines, cur = [], ''
        for w in words:
            if cur and len(cur) + 1 + len(w) > target * 1.25 and len(lines) < n - 1:
                lines.append(cur); cur = w
            else:
                cur = (cur + ' ' + w).strip()
        lines.append(cur)
    pink = next((i for i, l in enumerate(lines) if l.startswith('*')), None)
    lines = [l.lstrip('*').strip().upper() for l in lines]
    if pink is None:
        pink = 1 if len(lines) <= 3 else len(lines) - 2
    return lines, (pink if len(lines) > 1 else -1)


def punch_sprites(lines, pink, accent=None, x0=COVER_X0, x1=COVER_X1, top=PUNCH_TOP, bottom=PUNCH_BOTTOM, gap=10, cap=250, floor=84):
    return [(text_sprite(l, f, c), x, y) for l, f, c, x, y in punch_layout(lines, pink, accent, x0, x1, top, bottom, gap, cap, floor)]


def spoken_hook(post):
    """The voiceover hook: exactly the words of the on-screen punch headline (see voice.punch_speech)."""
    import voice
    return voice.punch_speech(punch_lines(post, clean(post['headline']))[0], clean(post['headline']))


def punch_word_sprites(lines, pink, accent=None):
    """Per-word highlight sprites for the big hook headline, in the colour that contrasts with the word's line (white words
    light up in the accent, the accent line lights up white). Same font/origin as the line, so it overlays glyph-exact.
    Returns [(word, (sprite, ox, oy), x_origin, y_origin)] in reading order."""
    d = ImageDraw.Draw(Image.new('L', (1, 1))); out = []
    for l, f, c, x, y in punch_layout(lines, pink, accent):
        ws = l.split(' ')
        for j, w in enumerate(ws):
            dx = d.textlength(' '.join(ws[:j]) + ' ', font=f) if j else 0
            out.append((w, text_sprite(w, f, WHITE if c != WHITE else (accent or PINK), shadow=False), x + dx, y))
    return out


def punch_layout(lines, pink, accent=None, x0=COVER_X0, x1=COVER_X1, top=PUNCH_TOP, bottom=PUNCH_BOTTOM, gap=10, cap=250, floor=84):
    """Each line sized to fill the column width (poster look), then the stack is scaled to fit the band, bottom-aligned."""
    d = ImageDraw.Draw(Image.new('L', (1, 1))); maxw = x1 - x0
    sizes = []
    for l in lines:
        f = FONT('Anton', 200); w = d.textlength(l, font=f)
        sizes.append(max(floor, min(cap, int(200 * maxw / max(1, w)))))
    def heights(sz):
        return [d.textbbox((0, 0), l, font=FONT('Anton', s))[3] - d.textbbox((0, 0), l, font=FONT('Anton', s))[1] for l, s in zip(lines, sz)]
    total = sum(heights(sizes)) + gap * (len(lines) - 1)
    if total > bottom - top:
        k = (bottom - top) / total; sizes = [max(40, int(s * k)) for s in sizes]
    hs = heights(sizes); y = bottom - (sum(hs) + gap * (len(lines) - 1)); out = []
    for i, (l, s, h) in enumerate(zip(lines, sizes, hs)):
        f = FONT('Anton', s)
        out.append((l, f, (accent or PINK) if i == pink else WHITE, x0, y - d.textbbox((0, 0), l, font=f)[1])); y += h + gap  # y = glyph top, not text origin
    return out


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
    # calibrated: flat gradient feed cards score ~0.9; low-key (dark, moody) real or photoreal scenes score ~3; bright photos 4-14
    return float(np.abs(np.diff(g, axis=1)).mean() + np.abs(np.diff(g, axis=0)).mean()) > 2.0


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
    def __init__(self, post, feed, photo, src, credit='', vo=None, total=None, v3=False):
        """vo: voice.synth() result (segments with word timings) -> voiceover-driven timeline with synced captions.
        Without it, the fixed 17.5s music-only timeline (SCENES) is used."""
        self.post, self.src, self.vo, self.v3 = post, src, vo, v3
        if vo:
            seg = {x['name']: dict(x) for x in vo['segments']}
            names = [x['name'] for x in vo['segments']]
            if 'end' not in seg:  # outro not spoken (it didn't fit): the end card follows the last point's last word
                last = seg[names[-1]]['end']
                seg['end'] = {'name': 'end', 'start': last + .3, 'end': last + .3, 'words': []}; names.append('end')
            # scene cuts sit exactly on the spoken boundaries: each section starts at its first word's onset; the end card's
            # short dissolve finishes on the outro's first word
            # story mode (default, AIFEED_VOICE_HOOK != headline): no spoken headline; the first point plays over the big
            # opening headline (captions above it) and the headline docks in the pause after that first sentence
            self.story_mode = 'hook' not in seg
            if self.story_mode:
                seg['hook'] = seg[names[0]]; names = ['hook'] + names[1:]
            starts = [0.0] + [seg[n]['start'] - (END_FADE if n == 'end' else 0) for n in names[1:]]
            self.hook_end, self.p1_on = seg['hook']['end'], seg[names[1]]['start']
            self.outro_on = seg['end']['start'] if 'end' in seg else None
            self.total = float(total or vo['seconds'] + .5)
            self.scenes = [(n, (starts[i + 1] if i + 1 < len(names) else self.total) - starts[i]) for i, n in enumerate(names)]
        else:
            self.scenes, self.total = list(SCENES), TOTAL
        self.cuts = np.cumsum([0] + [d for _, d in self.scenes])[:-1].tolist()
        self.credit = text_sprite(re.sub(r'\s*\(https?://\S+\)$', '', credit), FONT('Regular', 24), MUTED, shadow=True) if credit else None
        self.points = key_points(post)
        self.headline = clean(post['headline'])
        text_all = ' '.join([self.headline] + self.points)
        if BANNED.search(text_all):
            raise SystemExit('banned wording in reel text')
        ph = grade(trim_bars(photo.convert('RGB')))
        big = cover(ph, int(W * 1.22), int(H * 1.22))
        # heavy overlay, scaled down for photos that are already low-key so the scene doesn't crush to black
        lk = min(1.0, max(.2, float(np.asarray(ph.convert('L')).mean()) / 95))
        dark = vignette(Image.blend(big, Image.new('RGB', big.size, (0, 0, 0)), .42 * lk), .55 * lk)
        self.hook_bg = shade(dark, [(0, .55 * lk), (.16, .3 * lk), (.36, .38 * lk), (.5, .78), (.66, .93), (1, .97)], (0, 0, 0))
        self.pt_bg = shade(vignette(Image.blend(big, Image.new('RGB', big.size, (0, 0, 0)), .6)), [(0, .5), (.3, .45), (.7, .55), (1, .7)], (0, 0, 0))
        # category pill
        cat = (post.get('category') or 'AI News').upper()
        f = FONT('Bold', 34); tw = int(ImageDraw.Draw(Image.new('L', (1, 1))).textlength(cat, font=f))
        self.pill = Image.new('RGBA', (tw + 56, 64), (0, 0, 0, 0))
        dp = ImageDraw.Draw(self.pill); pbg, pfg = pill_colors(post.get('category'))
        self.accent = accent_color(post.get('category'))
        # outlined pill (poster style): category color outline + text on a dark glass fill; lift very dark colors for contrast
        lum = (.2126 * pbg[0] + .7152 * pbg[1] + .0722 * pbg[2]) / 255
        ink = self.accent
        dp.rounded_rectangle((0, 0, tw + 55, 63), 10, fill=(0, 0, 0, 150), outline=ink + (255,), width=4)
        dp.text(((tw + 56) / 2, 33), cat, font=f, fill=ink, anchor='mm')
        # headline lines
        self.punch, self.punch_pink = punch_lines(post, self.headline)
        if BANNED.search(' '.join(self.punch)):
            raise SystemExit('banned wording in punch headline')
        self.h_lines = punch_sprites(self.punch, self.punch_pink, self.accent)
        # the spoken hook is exactly these words (voice.punch_speech), so each spoken hook word lights up its on-screen word
        self.h_words, self.hook_times = punch_word_sprites(self.punch, self.punch_pink, self.accent), []
        if vo:
            hw = next((sg['words'] for sg in vo['segments'] if sg['name'] == 'hook'), [])
            if len(hw) == len(self.h_words):
                self.hook_times = [(w[1], w[2]) for w in hw]
        # docked headline for the voiceover/caption scenes: same single headline, smaller, still in the 3:4 band
        self.d_lines = punch_sprites(self.punch, self.punch_pink, self.accent, top=DOCK_TOP, bottom=DOCK_BOTTOM, gap=8, cap=130, floor=44)
        self.captions = self._captions() if vo else []
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
        self.num = [text_sprite(f'0{i + 1}', FONT('Bold', 190), self.accent, shadow=False) for i in range(3)]
        self.src_spr = text_sprite(('Source: ' + src) if src else 'aifeed.run', FONT('SemiBold', 38), MUTED, shadow=False)
        self.brand = self._brand(54, shadow=True)
        self.end_logo = self._brand(150, shadow=True)
        self.tag = text_sprite('The AI news that matters.', FONT('Regular', 56), WHITE, shadow=False)
        self.cta = self._cta()
        self.web = text_sprite('Free newsletter at aifeed.run', FONT('Regular', 40), MUTED, shadow=False)
        self.src_small = text_sprite(('Source: ' + src) if src else '', FONT('SemiBold', 30), MUTED, shadow=True) if src else None
        self.end_bg = self._end_bg(big)
        if v3:
            self._v3_end_init()

    def _v3_end_init(self):
        """v3 end card sprites: save-worthy takeaway (Anton, white), targeted share prompt (accent), follow line (white)."""
        self.takeaway = takeaway_text(self.post)
        self.share = share_prompt(self.post.get('category'))
        for t in (self.takeaway, self.share, FOLLOW_LINE):
            if BANNED.search(t):
                raise SystemExit('banned wording in v3 end card')
        d = ImageDraw.Draw(Image.new('L', (1, 1)))
        tf, tl, tlh = fit(self.takeaway.upper(), 'Anton', SAFE_X1 - SAFE_X0, 470, 104, 64, 1.12)
        y = 430; self.e_take = []
        for l in tl:
            self.e_take.append((text_sprite(l, FONT('Anton', tf.size), WHITE), SAFE_X0, y)); y += tlh
        self.e_bar_y = y + 26
        sf, sl, slh = fit(self.share, 'Bold', SAFE_X1 - SAFE_X0, 140, 54, 40, 1.18)
        y = self.e_bar_y + 60; self.e_share = []
        for l in sl:
            self.e_share.append((text_sprite(l, sf, self.accent), SAFE_X0, y)); y += slh
        ff, fl, flh = fit(FOLLOW_LINE, 'SemiBold', SAFE_X1 - SAFE_X0, 130, 46, 36, 1.2)
        y = max(y + 50, 1180); self.e_follow = []
        for l in fl:
            self.e_follow.append((text_sprite(l, ff, WHITE), SAFE_X0, y)); y += flh
        self.e_bottom = y

    def v3_end(self, t):
        fr = self.end_bg.copy().convert('RGBA'); lt = max(0.0, t - self.cuts[-1])
        paste_alpha(fr, self.pill, COVER_X0, SAFE_TOP + 40)  # same single pill, top-left
        for i, ((spr, ox, oy), x, y) in enumerate(self.e_take):
            p = ease_out((lt - .04 * i) / .22); paste_alpha(fr, spr, x - ox, y - oy + 24 * (1 - p), p)
        ImageDraw.Draw(fr).rectangle((SAFE_X0, self.e_bar_y, SAFE_X0 + 200 * ease_out((lt - .1) / .3), self.e_bar_y + 10), fill=self.accent)
        for (spr, ox, oy), x, y in self.e_share:
            p = ease_out((lt - .35) / .25); paste_alpha(fr, spr, x - ox, y - oy + 20 * (1 - p), p)
        for (spr, ox, oy), x, y in self.e_follow:
            p = ease_out((lt - .6) / .25); paste_alpha(fr, spr, x - ox, y - oy + 20 * (1 - p), p)
        self.logo(fr)  # one logo, bottom-right
        self.progress(fr, t)
        fade = ease_out(lt / END_FADE)
        if fade < 1:
            fr = Image.blend(self.scene_frame(t, 1.0), fr, fade)
        return fr.convert('RGB')

    def _captions(self):
        """Phrase captions (3-4 words) with per-word timings; the spoken word is drawn in the category accent."""
        import voice
        d = ImageDraw.Draw(Image.new('L', (1, 1))); out = []
        for sg in self.vo['segments']:
            if sg['name'] in ('hook', 'end') or not sg['words']:
                continue  # hook: the punch headline is the caption; end card: the logo/CTA is
            for words, t0, t1 in voice.phrases(sg['words']):
                text = ' '.join(w for w, _, _ in words)
                for size in (CAP_SIZE, 74, 64):
                    f = FONT('Bold', size); lines = wrap(text, f, CAP_X1 - CAP_X0)
                    if len(lines) <= 2:
                        break
                lh = int(size * 1.18); items, wi = [], 0
                for li, line in enumerate(lines):
                    x = CAP_X0
                    for w in line.split():
                        tw, ta, tb = words[wi]
                        items.append((text_sprite(w, f, WHITE), text_sprite(w, f, self.accent), x, CAP_TOP + li * lh, ta, tb))
                        x += d.textlength(w + ' ', font=f); wi += 1
                out.append((t0, t1, items))
        return out

    def draw_captions(self, fr, t, dy=0):
        """Frame at time t shows a word as spoken from the frame nearest its audio onset (half-frame rounding), until the
        next word starts; the phrase appears on its first word's onset. Timings are the TTS model's own phoneme durations."""
        h = .5 / FPS
        for t0, t1, items in self.captions:
            if not (t0 - h <= t < t1 - h):
                continue
            pop = ease_out((t - t0 + h) / .06)
            for j, ((w, ox, oy), (a, ax, ay), x, y, ta, tb) in enumerate(items):
                nxt = items[j + 1][4] if j + 1 < len(items) else max(tb + .15, t1)
                on = ta - h <= t < nxt - h
                if on:
                    paste_alpha(fr, a, x - ax, y + dy - ay)  # the spoken word: accent, full opacity, no offset
                else:
                    paste_alpha(fr, w, x - ox, y + dy - oy + 10 * (1 - pop), (1.0 if t >= ta - h else .72) * (.5 + .5 * pop))
            return

    def _brand(self, size, shadow=False):
        f = FONT('Bold', size)
        a, ax, ay = text_sprite('AIFeed', f, WHITE, shadow); b, bx, by = text_sprite('.run', f, ORANGE, shadow)
        d = ImageDraw.Draw(Image.new('L', (1, 1))); wa = d.textlength('AIFeed', font=f)
        im = Image.new('RGBA', (int(wa) + b.width, max(a.height, b.height)), (0, 0, 0, 0))
        im.alpha_composite(a, (0, 0)); im.alpha_composite(b, (int(wa) + ax - bx, ay - by))
        return im

    def _cta(self):
        im = Image.new('RGBA', (640, 112), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
        acc = self.accent; txt = WHITE if contrast(acc, WHITE) >= contrast(acc, (17, 17, 17)) else (17, 17, 17)  # end-card CTA in the story accent
        d.rounded_rectangle((0, 0, 639, 111), 56, fill=acc + (255,))
        d.text((320, 57), 'Follow @aifeed.run', font=FONT('Bold', 46), fill=txt, anchor='mm')
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
        n = len(self.scenes); gap = 10; w = (SAFE_X1 + 60 - SAFE_X0 - gap * (n - 1)) / n
        for i, (c, (_, dur)) in enumerate(zip(self.cuts, self.scenes)):
            x0 = SAFE_X0 + i * (w + gap); fill = min(max((t - c) / dur, 0), 1)
            d.rounded_rectangle((x0, 196, x0 + w, 204), 4, fill=(255, 255, 255, 70))
            if fill > 0:
                d.rounded_rectangle((x0, 196, x0 + max(8, w * fill), 204), 4, fill=WHITE + (255,))

    def zoom_crop(self, img, z, cx=.5, cy=.5):
        """z=1 shows the whole (oversized) image; larger z punches in."""
        cw, ch = img.width / z, img.height / z
        x0 = (img.width - cw) * cx; y0 = (img.height - ch) * cy
        return img.crop((int(x0), int(y0), int(x0 + cw), int(y0 + ch))).resize((W, H), Image.BILINEAR)

    def logo(self, fr, a=1.0, y=SAFE_BOTTOM + 8):
        paste_alpha(fr, self.brand, SAFE_X1 + 20 - self.brand.width, y, a)  # bottom-right, inside safe zone

    def draw_cover_text(self, fr, lt):
        # all cover elements inside the 3:4 grid band (y 240-1680): pill y 290, punch 900-1520, logo ~1548, credit ~1640
        pt = ease_out((lt - .05) / .25); paste_alpha(fr, self.pill, COVER_X0 - 30 * (1 - pt), SAFE_TOP + 40, pt)
        for i, ((spr, ox, oy), x, y) in enumerate(self.h_lines):
            p = ease_out((lt - .1 - i * .1) / .32)
            paste_alpha(fr, spr, x - ox, y - oy + 60 * (1 - p), p)
        sw = ease_out((lt - .5) / .5)  # accent underline (category color), left of the logo row
        if sw > 0:
            ImageDraw.Draw(fr).rectangle((COVER_X0, PUNCH_BOTTOM + 34, COVER_X0 + 200 * sw, PUNCH_BOTTOM + 44), fill=self.accent)
        self.logo(fr, ease_out((lt - .3) / .3), PUNCH_BOTTOM + 28)
        if self.credit:  # CC BY / BY-SA attribution on the frames that show the photo full-bleed
            spr, ox, oy = self.credit; paste_alpha(fr, spr, COVER_X0 - ox, GRID_BOTTOM - 44 - oy, .85)

    def cover(self):
        """IG grid cover (cover_url): the fully revealed opening frame, no progress bar."""
        fr = self.zoom_crop(self.hook_bg, 1.04, .5, .4).convert('RGBA'); self.draw_cover_text(fr, 5)
        return fr.convert('RGB')

    def frame(self, t):
        si = max(i for i, c in enumerate(self.cuts) if t >= c - 1e-6); lt = t - self.cuts[si]; name = self.scenes[si][0]
        if self.vo:
            return self.frame_vo(t, si, lt, name)
        if name == 'hook':
            # hook-first: frame 0 is the cover (scene + full punch headline), then a slow push-in. No build, no fade.
            fr = self.zoom_crop(self.hook_bg, 1.04 + .05 * lt / self.scenes[0][1], .5, .4).convert('RGBA')
            self.draw_cover_text(fr, 5)
        elif name.startswith('p'):
            k = int(name[1]) - 1
            z = 1.0 + .06 * lt / 3.5
            fr = self.zoom_crop(self.pt_bg, z, (.2, .8, .5)[k], (.3, .6, .45)[k]).convert('RGBA')  # new framing per point
            self.logo(fr)
            spr, ox, oy = self.num[k]; p = ease_back(lt / .35)
            paste_alpha(fr, spr, SAFE_X0 - ox, 340 - oy, min(1, lt / .2), .6 + .4 * p)
            ImageDraw.Draw(fr).rectangle((SAFE_X0, 572, SAFE_X0 + 160 * ease_out(lt / .4), 582), fill=self.accent)
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
        if si > 1 and lt < .2:  # no flash on the hook -> first point handoff
            f = 1 - lt / .2
            sc = 1 + .05 * f
            fr = fr.resize((int(W * sc), int(H * sc)), Image.BILINEAR).crop((int((W * sc - W) / 2), int((H * sc - H) / 2), int((W * sc - W) / 2) + W, int((H * sc - H) / 2) + H))
            fr = Image.blend(fr, Image.new('RGBA', (W, H), WHITE + (255,)), .28 * f ** 2)
        return fr.convert('RGB')

    def frame_vo(self, t, si, lt, name):
        """Voiceover timeline: one continuous push-in on the scene; hook = the cover; then the headline docks smaller
        above the synced captions; end card last."""
        if name == 'end' and self.v3:
            return self.v3_end(t)
        if name == 'end':
            fr = self.end_bg.copy().convert('RGBA'); lt = max(0.0, t - self.outro_on) if self.outro_on is not None else lt
            p = ease_back(lt / .3)
            lg = self.end_logo; paste_alpha(fr, lg, (W - lg.width) / 2, 640, min(1, lt / .12), .75 + .25 * p)
            s, ox, oy = self.tag; tp = ease_out((lt - .15) / .3); paste_alpha(fr, s, (W - s.width) / 2, 860 + 30 * (1 - tp), tp)
            cp = ease_back((lt - .3) / .35); paste_alpha(fr, self.cta, (W - 640) / 2, 1010 + 40 * (1 - min(cp, 1)), ease_out((lt - .3) / .2))
            s, ox, oy = self.web; paste_alpha(fr, s, (W - s.width) / 2, 1160, ease_out((lt - .55) / .3))
            self.progress(fr, t)
            fade = ease_out((t - self.cuts[-1]) / END_FADE)  # dissolve that lands on the outro's first word
            if fade < 1:
                prev = self.scene_frame(t, 1.0)
                fr = Image.blend(prev, fr, fade)
            return fr.convert('RGB')
        # the headline docks in the pause between the hook's last word and the first point's first word (spoken boundary)
        k = ease_out((t - self.hook_end) / max(1 / FPS, self.p1_on - self.hook_end))
        fr = self.scene_frame(t, k)
        self.progress(fr, t)
        return fr.convert('RGB')

    def hook_word(self, t):
        """Index of the on-screen hook word being spoken at t (same lead as the captions), else None."""
        lead = .5 / FPS  # half-frame rounding, as draw_captions
        for i, (a, b) in enumerate(self.hook_times):
            nxt = self.hook_times[i + 1][0] if i + 1 < len(self.hook_times) else b + .15
            if a - lead <= t < max(b, nxt) - lead:
                return i
        return None

    def scene_frame(self, t, k):
        """k: 0 = hook layout (cover), 1 = docked headline + captions."""
        scene_end = self.cuts[-1] if self.scenes[-1][0] == 'end' else self.total
        fr = self.zoom_crop(self.hook_bg, 1.04 + PUSH * min(t, scene_end) / max(1, scene_end), .5, .4).convert('RGBA')
        paste_alpha(fr, self.pill, COVER_X0, SAFE_TOP + 40)
        dr = ImageDraw.Draw(fr)
        if k <= 0:
            for (spr, ox, oy), x, y in self.h_lines:
                paste_alpha(fr, spr, x - ox, y - oy)
            a = self.hook_word(t)
            if a is not None:
                _, (spr, ox, oy), x, y = self.h_words[a]; paste_alpha(fr, spr, x - ox, y - oy)
            if self.vo and self.story_mode:
                self.draw_captions(fr, t, HOOK_CAP_TOP - CAP_TOP)
            dr.rectangle((COVER_X0, PUNCH_BOTTOM + 34, COVER_X0 + 200, PUNCH_BOTTOM + 44), fill=self.accent)
            self.logo(fr, 1, PUNCH_BOTTOM + 28)
        else:
            for ((bs, box, boy), bx, by), ((ds, dox, doy), dx, dy) in zip(self.h_lines, self.d_lines):
                if k >= 1:
                    paste_alpha(fr, ds, dx - dox, dy - doy); continue
                sc = 1 + ((ds.height - 48) / max(1, bs.height - 48) - 1) * k  # glyph-height ratio (sprites carry 2x24px pad)
                spr = bs.resize((max(1, int(bs.width * sc)), max(1, int(bs.height * sc))), Image.BILINEAR)
                gx = bx + (dx - bx) * k; gy = by + (dy - by) * k  # glyph top-left
                paste_alpha(fr, spr, gx - box * sc, gy - boy * sc)
            uy = PUNCH_BOTTOM + 34 + (DOCK_BOTTOM + 22 - PUNCH_BOTTOM - 34) * k
            dr.rectangle((COVER_X0, uy, COVER_X0 + 200 - 60 * k, uy + 10 - 2 * k), fill=self.accent)
            self.logo(fr, 1, PUNCH_BOTTOM + 28 + (SAFE_BOTTOM + 8 - PUNCH_BOTTOM - 28) * k)
            if self.src_small:
                s, ox, oy = self.src_small; paste_alpha(fr, s, COVER_X0 - ox, SAFE_BOTTOM + 22 - oy, .9 * k)
            self.draw_captions(fr, t)
        if self.credit:
            spr, ox, oy = self.credit; paste_alpha(fr, spr, COVER_X0 - ox, GRID_BOTTOM - 44 - oy, .85)
        return fr


# ---------- audio ----------
def music(path, dur, seed=0, cuts=None):
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
    for c in (CUTS if cuts is None else cuts)[1:]:  # impact + reverse-swell riser into each cut
        mm = (t >= c) & (t < c + .8); il = t[mm] - c
        out[mm] += 0.45 * np.sin(2 * np.pi * (40 + 60 * np.exp(-il * 12)) * il) * np.exp(-il * 5)
        out[mm] += 0.10 * rng.normal(0, 1, mm.sum()) * np.exp(-il * 14)
        mm = (t >= c - .5) & (t < c); rl = (t[mm] - (c - .5)) / .5
        out[mm] += 0.07 * rng.normal(0, 1, mm.sum()) * rl ** 3
    fade = np.minimum(1, np.minimum(t / .05, (dur - t) / 1.2))
    out = np.tanh(out * fade * 1.1) * .8
    write_wav(path, np.stack([out, np.roll(out, 220)], 1), sr)
    return out


def write_wav(path, st, sr=44100):
    with wave.open(path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes((np.clip(st, -1, 1) * 32767).astype('<i2').tobytes())


def mix_voice(path, vo, dur, seed, cuts, bed=True):
    """Voiceover up front, the bundled synthesized bed (original, generated in code, royalty-free) ducked under speech."""
    import voice
    sr = 44100; n = int(sr * dur)
    v = vo['audio'].astype(np.float64)
    v = np.interp(np.arange(int(len(v) * sr / voice.SR)) * voice.SR / sr, np.arange(len(v)), v)
    v = v / max(1e-6, np.abs(v).max()) * .89
    vv = np.zeros(n); vv[:min(n, len(v))] = v[:n]
    out = vv
    if bed:
        tmp = path + '.bed.wav'; m = music(tmp, dur, seed, cuts); os.remove(tmp)
        t = np.arange(n) / sr; speech = np.zeros(n)
        for sg in vo['segments']:
            speech[(t >= sg['start'] - .05) & (t < sg['end'] + .05)] = 1
        k = int(sr * .12); speech = np.convolve(speech, np.ones(k) / k, 'same')  # smooth duck
        out = vv + m[:n] * (.30 - .20 * speech)
    write_wav(path, np.stack([out, out], 1), sr)


# Scenes: build() now uses scenes.pick_scene (story-themed generated scene -> story photo -> theme-keyword Commons ->
# feed photo, with a quality gate). The category queries below are legacy (load_photo only) and not used by build().
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


def voice_attempts(voice_mod):
    """(voice, speed) tries for the voiceover: the chosen voice at its pace, the same voice at another pace, then the
    fallback voice (AIFEED_KOKORO_FALLBACK_VOICE, default am_adam; 'off' disables it). Music-only only after all fail."""
    v, sp = voice_mod.VOICE, voice_mod.SPEED
    tries = [(v, sp), (v, 1.0 if abs(sp - 1.0) > .01 else .95)]
    fb = os.environ.get('AIFEED_KOKORO_FALLBACK_VOICE', 'am_adam').strip()
    if fb and fb.lower() not in ('off', '0', 'false', 'none') and fb != v:
        tries.append((fb, sp))
    return tries


def voice_retry(voice_mod, fit):
    """Run fit(voice=..., speed=..., budget=...) for each voice_attempts() entry until one works; every try has its own
    capped budget (AIFEED_VOICE_MAX_SYNTH syntheses / AIFEED_VOICE_MAX_S seconds). Raises the joined errors if all fail."""
    errs = []
    for v, sp in voice_attempts(voice_mod):
        try:
            return fit(voice=v, speed=sp, budget=voice_mod.Budget())
        except Exception as e:
            errs.append(f'{v}@{sp:.2f}: {e}')
            print(f'voiceover try failed ({v} @ {sp:.2f}): {e}', file=sys.stderr)
    raise RuntimeError(' | '.join(errs))


def build(post, feed_path, out, seed=0, photo=None, scene_path=None, scene_source='', scene_credit=''):
    feed = Image.open(feed_path)
    src = clean(post.get('source') or post.get('outlet') or '') or outlet_from_url(post.get('sourceUrl', ''))
    sys.path.insert(0, HERE); import scenes
    if not post.get('punch') or not scenes.valid_punch(post.get('punch')):
        post = dict(post, punch=scenes.rule_punch(post.get('headline', '')))  # LLM punch missing/invalid -> rule-based
    scene_log = []
    if scene_path:  # the scene make_slides.py already picked for the carousel + Story: one image, no second generation
        img = Image.open(scene_path).convert('RGB'); credit, scene_src = clean(scene_credit), scene_source or 'shared'
        scene_log.append(f'{scene_src}: shared with carousel')
    else:
        img, credit, scene_src = scenes.pick_scene(post, photo, feed, scene_log)
    if scene_src == 'story' and not scene_path:
        credit = clean(post.get('photoCredit') or '')  # caller-supplied attribution for a licensed local photo
    vo, segs, total, voice_name, vo_err = None, None, None, '', ''
    v3, style_req = reel_template() == 'v3', hook_style()
    style_used = ''
    if v3:
        hp, style_used = pick_hook(post, style_req)
        if hp:
            post = dict(post, punch=hp)
    if v3 and os.environ.get('AIFEED_REEL_VOICE', 'on').lower() not in ('off', '0', 'false'):
        try:
            import voice
            vp = voice.voice_path(timeout=90)
            if not vp:
                raise RuntimeError('Kokoro model not available')
            cands = voice_points(post, n=130, story=True) or [x for x in key_points(post) if x != 'Full story at aifeed.run.'][:1]
            vo, segs, total = voice_retry(voice, lambda **kw: voice.fit_v3(spoken_hook(post), cands, path=vp, lo=V3_MIN_S, hi=V3_MAX_S,
                                                                         end_hold=V3_END_HOLD, **kw))
            voice_name = f"kokoro:{vo['voice']}@{vo['speed']:.2f}"
        except Exception as e:
            vo_err = str(e)[:300]; vo = None
            print('voiceover unavailable, rendering music-only:', vo_err, file=sys.stderr)
    elif os.environ.get('AIFEED_REEL_VOICE', 'on').lower() not in ('off', '0', 'false'):
        try:
            import voice
            vp = voice.voice_path(timeout=90)  # the workflow normally pre-caches it; don't stall a live slot
            if not vp:
                raise RuntimeError('Kokoro model not available')
            story = os.environ.get('AIFEED_VOICE_HOOK', 'story').lower() != 'headline'
            cands = voice_points(post, story=story) or [x for x in key_points(post) if x != 'Full story at aifeed.run.'][:1]
            # the hook is spoken as EXACTLY the on-screen punch headline words (not the source title)
            # AIFEED_VOICE_HOOK=headline: the voice first reads EXACTLY the on-screen punch headline; default 'story': the
            # voice skips the headline and tells the story from the first word (up to 4 points)
            hook = None if story else spoken_hook(post)
            vo, segs, total = voice_retry(voice, lambda **kw: voice.fit_duration(hook, cands, path=vp, lo=MIN_S, hi=MAX_S, exact_hook=True,
                                                                               max_points=3 if hook else 4, **kw))
            voice_name = f"kokoro:{vo['voice']}@{vo['speed']:.2f}"
        except Exception as e:  # never lose the slot over TTS: fall back to the music-only timeline
            vo_err = str(e)[:300]; vo = None
            print('voiceover unavailable, rendering music-only:', vo_err, file=sys.stderr)
    r = Reel(post, feed, img, src, credit, vo, total, v3=v3 and vo is not None)
    cover_path = os.path.splitext(out)[0] + '_cover.jpg'
    r.cover().save(cover_path, quality=92)
    tmp = tempfile.mkdtemp(prefix='reel-'); wav = os.path.join(tmp, 'audio.wav')
    if vo and os.environ.get('AIFEED_REEL_DEBUG'):  # the voice track alone, for the sync checker
        write_wav(os.path.splitext(out)[0] + '_voice.wav', np.stack([vo['audio'], vo['audio']], 1), voice.SR)
    if vo:
        mix_voice(wav, vo, r.total, seed, r.cuts, os.environ.get('AIFEED_REEL_MUSIC', 'on').lower() not in ('off', '0', 'false'))
    else:
        music(wav, r.total, seed, r.cuts)
    p = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                          '-i', wav, '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
                          '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-shortest', '-movflags', '+faststart', out], stdin=subprocess.PIPE)
    for i in range(int(round(r.total * FPS))):
        p.stdin.write(r.frame(i / FPS).tobytes())
    p.stdin.close()
    if p.wait() != 0:
        raise SystemExit('ffmpeg failed')
    shutil.rmtree(tmp, ignore_errors=True)
    res = {'out': out, 'cover': cover_path, 'seconds': round(r.total, 2), 'points': [t for n, t in segs if n.startswith('p')] if segs else r.points, 'photoCredit': credit,
           'punch': post.get('punch'), 'sceneSource': scene_src, 'sceneLog': scene_log, 'voice': voice_name or None,
           'voiceover': [t for _, t in segs] if segs else None}
    if vo_err:
        res['voiceError'] = vo_err
    res['template'] = 'v3' if r.v3 else 'v2'
    if r.v3:
        res.update(hookStyle=style_used or None, hookStyleRequested=style_req or None, takeaway=r.takeaway, sharePrompt=r.share,
                   audioOnset=round(vo['segments'][0]['words'][0][1], 3) if vo['segments'][0]['words'] else None)
    if vo:
        res['captions'] = [[w, round(a, 3), round(b, 3)] for sg in vo['segments'] for w, a, b in sg['words']]
        res['timeline'] = {'cuts': [round(c, 3) for c in r.cuts], 'scenes': [n for n, _ in r.scenes], 'hookEnd': round(r.hook_end, 3),
                           'firstPointOnset': round(r.p1_on, 3), 'outroOnset': r.outro_on and round(r.outro_on, 3)}
        if os.environ.get('AIFEED_REEL_DEBUG'):  # caption word boxes, for the sync checker
            res['captionBoxes'] = [[w[0].width - 48, w[0].height - 48, x, y, ta, tb] for _, _, items in r.captions for w, _, x, y, ta, tb in items]
    return res


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--post', required=True); ap.add_argument('--image', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--photo', default=''); ap.add_argument('--punch', default='', help="'LINE / *PINK LINE / LINE'"); ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--scene', default=''); ap.add_argument('--scene-source', default=''); ap.add_argument('--scene-credit', default='')
    ap.add_argument('--scene-prompt', default=''); ap.add_argument('--scene-keywords', default='', help='comma separated')
    a = ap.parse_args()
    post = json.load(open(a.post))
    if a.punch:
        post['punch'] = a.punch
    if a.scene_prompt:
        post['scenePrompt'] = a.scene_prompt
    if a.scene_keywords:
        post['sceneKeywords'] = [k.strip() for k in a.scene_keywords.split(',') if k.strip()]
    print(json.dumps(build(post, a.image, a.out, a.seed, a.photo or None, a.scene or None, a.scene_source, a.scene_credit)))
