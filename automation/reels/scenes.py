"""Story-themed scene picker for AIFeed Reels (free sources only, no keys).

Cascade (first one that passes the quality gate wins):
  0. cloudflare - Workers AI flux-1-schnell, only if CF_ACCOUNT_ID + CF_API_TOKEN secrets exist (free 10k neurons/day)
  1. generated  - photoreal scene from a story-specific prompt via Pollinations' free keyless endpoint
                  (best effort, rate-limited per IP; disable with AIFEED_SCENE_GEN=off)
  2. story      - the story's own photo (og:image picked by the pipeline)
  3. commons    - Wikimedia Commons search on THEME keywords from the story (never a category-generic query)
  4. feed       - photo area of the feed graphic, only if it is a real photo
Quality gate: real photographic detail (is_photo), not too dark, not too busy, big enough.
Every accepted scene is fitted to 9:16 with the subject kept in the upper half (above the headline band).
"""
import hashlib, io, json, math, os, re, sys, urllib.error, urllib.parse, urllib.request
import numpy as np
from PIL import Image, ImageFilter

UA = {'User-Agent': 'aifeed-reels/1.0 (https://aifeed.run)'}
FREE_LICENSES = re.compile(r'^(CC0|Public domain|CC BY(-SA)? [0-9.]+|No restrictions)$', re.I)
STYLE = ('photorealistic cinematic editorial news photograph, dramatic low-key lighting, deep shadows, rim light, '
         'shallow depth of field, moody but well exposed, the main subject clearly lit and readable, centered horizontally in the upper half of the frame, '
         'the lower part of the frame falls off into dark shadow, any screens or displays are out of focus and show only '
         'abstract glowing lines and shapes with no numbers or writing, no text, no letters, no captions, no logos, '
         'no watermark, no recognizable real person, people only as silhouettes or seen from behind, 35mm film grain')

# theme rules: (regex on headline+summary, scene subject for generation, Commons keyword queries)
THEMES = [
    (r'credit default|cds|\bdebt\b|bond|default|distress|selloff|sell-off|plunge|crash|bubble|losses?\b',
     'a stressed trader, head in hand, his face profile rim-lit by red light, in front of a wall of out-of-focus monitors glowing with red downward-crashing chart lines, the trader centered in the frame',
     ['stock market crash screen red', 'trading floor screens']),
    (r'genom|\bdna\b|gene\b|genes\b|protein|biolog|cell\b|drug discovery|alphafold',
     'a huge glowing cyan DNA double helix hologram, tangled, broken and glitching into red fragments, floating in the middle of a dark lab, a scientist silhouette seen from behind standing just below it, looking up',
     ['DNA gel electrophoresis UV', 'DNA sequencing laboratory']),
    (r'data ?cent|datacenter|server|compute|gpu cluster|coreweave|stargate|power grid|electricity',
     'a long dark data center corridor of server racks with blue status lights, a lone silhouette walking',
     ['data center server racks', 'server room']),
    (r'chip|semiconductor|nvidia|tsmc|\bamd\b|wafer|export control',
     'a macro shot of a glowing processor chip on a circuit board with red and blue light trails',
     ['silicon wafer', 'computer chip macro']),
    (r'fbi|arrest|spy|espionage|lawsuit|court|judge|sued|indict|police|charges',
     'a dark empty conference room at night, a single hard spotlight on a small hidden microphone under the table, red and blue light through the blinds',
     ['courtroom', 'police tape night']),
    (r'congress|senate|white house|regulat|law\b|bill\b|policy|government|ban\b|eu ai act',
     'the US Capitol dome at night under storm clouds, red and blue light',
     ['United States Capitol night']),
    (r'robot|humanoid|optimus|autonomous|self-driving|waymo|drone',
     'a humanoid robot in a dark factory, rim-lit, looking at its own hand',
     ['humanoid robot', 'industrial robot arm']),
    (r'music|song|singer|artist|youtube|spotify|film|hollywood|actor|voice clone',
     'a vintage studio microphone in a single beam of light in a dark recording studio, a glowing golden audio waveform floating in the air beside it, no people',
     ['recording studio microphone', 'concert stage lights']),
    (r'phone|smartphone|iphone|pixel|call|assistant|voice',
     'a hand holding a smartphone in a dark room, the screen glowing, light on the fingers',
     ['smartphone in hand dark']),
    (r'safety|risk|danger|harm|security|hack|breach|leak|vulnerab|malware',
     'a dark security operations room, red alert lights reflecting on screens, a silhouette watching',
     ['security operations center', 'server room red light']),
    (r'funding|raises|valuation|ipo|investor|billion|acquisition|acquire|deal',
     'a glass skyscraper boardroom at night overlooking a city, silhouettes around a table',
     ['skyscraper boardroom night', 'stock exchange']),
    (r'model|llm|chatbot|gpt|gemini|claude|grok|openai|anthropic|agent',
     'a dark room lit only by a giant screen of flowing neural network light, a silhouette facing it',
     ['neural network visualization', 'computer screen code dark']),
]
DEFAULT_THEME = ('a dark newsroom-style tech scene, glowing screens and city lights through a window, silhouette',
                 ['computer screen code dark'])


def theme_for(post):
    text = ' '.join(str(post.get(k) or '') for k in ('headline', 'summary', 'title')).lower()
    for rx, subject, queries in THEMES:
        if re.search(rx, text):
            return subject, queries
    return DEFAULT_THEME


def scene_prompt(post):
    p = (post.get('scenePrompt') or '').strip()
    if not p:
        p = theme_for(post)[0]
    return p + ', ' + STYLE


def scene_keywords(post):
    kw = [k for k in (post.get('sceneKeywords') or []) if isinstance(k, str) and k.strip()]
    return kw[:3] + theme_for(post)[1]


# ---------- rule-based punch headline (used when the pipeline has no LLM punch) ----------
CUT = re.compile(r'\s(?:as|amid|after|while|because|according to|despite|following|with|says|said|tells|who|which|that)\s|[:\u2014\u2013;]|,\s', re.I)
FILLER = {'the', 'a', 'an', 'our', 'its', 'their', 'very', 'really', 'just'}
TAIL_STOP = {'of', 'to', 'with', 'for', 'on', 'in', 'and', 'or', 'who', 'will', 'can', 'must', 'the', 'a', 'an', 'is', 'are', 'at', 'by'}
MAXCH = 58  # Anton at poster size fits ~14-15 chars per line; 4 lines


def _balanced(words, n):
    """Split words into n lines minimizing the longest line (brute force; headlines are short)."""
    best = None
    from itertools import combinations
    for cuts in combinations(range(1, len(words)), n - 1):
        idx = (0,) + cuts + (len(words),)
        lines = [' '.join(words[idx[i]:idx[i + 1]]) for i in range(n)]
        score = max(len(l) for l in lines)
        if best is None or score < best[0]:
            best = (score, lines)
    return best[1] if best else [' '.join(words)]


def rule_punch(headline):
    """Rule-based punch headline: first clause, filler removed, 3-4 balanced all-caps lines, one '*' accent line.
    'CoreWeave credit default swaps hit distress levels as investors sour on AI debt'
      -> 'COREWEAVE CREDIT / DEFAULT SWAPS / *HIT DISTRESS / LEVELS'"""
    h = re.sub(r'\s+', ' ', str(headline or '')).strip().rstrip('.')
    m = next((x for x in CUT.finditer(h) if x.start() >= 24), None)  # keep at least a real subject + verb + object
    core = h[:m.start()].strip() if m else h
    words = [w for i, w in enumerate(core.split()) if i == 0 or w.lower() not in FILLER]
    while len(' '.join(words)) > MAXCH and len(words) > 3:
        words.pop()
    while len(words) > 3 and words[-1].lower() in TAIL_STOP:
        words.pop()
    total = len(' '.join(words))
    n = 3 if total <= 30 else 4
    n = max(1, min(n, len(words)))
    lines = _balanced(words, n)
    acc = 1 if len(lines) == 2 else len(lines) - 2 if len(lines) == 4 else 1
    return ' / '.join(('*' if i == acc and len(lines) > 1 else '') + l.upper() for i, l in enumerate(lines))


def valid_punch(p):
    if not isinstance(p, str):
        return False
    lines = [l.strip() for l in p.split('/') if l.strip()]
    return 2 <= len(lines) <= 4 and sum(l.startswith('*') for l in lines) == 1 and all(len(l.lstrip('*')) <= 22 for l in lines) \
        and not re.search(r'\bdaily\b|edited', p, re.I)


# ---------- quality gate ----------
def detail(img):
    g = np.asarray(img.convert('L').resize((270, 480))).astype(np.float32)
    return float(np.abs(np.diff(g, axis=1)).mean() + np.abs(np.diff(g, axis=0)).mean())


def gate(img):
    """Returns '' if usable, else the reason. Thresholds calibrated on real covers:
    gradient card ~0.9 detail, low-key photos ~3, normal 4-14, cluttered screenshots/collages > 26."""
    if img is None:
        return 'missing'
    if min(img.size) < 450:
        return 'too small %dx%d' % img.size
    d = detail(img)
    g = np.asarray(img.convert('L')).astype(np.float32)
    lum = float(g[: int(g.shape[0] * .6)].mean())  # subject region; a dark bottom is wanted (headline band)
    if d <= 2.0:
        return 'not photographic (detail %.1f)' % d
    if d > 26:
        return 'too busy (detail %.1f)' % d
    if lum < 14:
        return 'too dark (mean %.0f)' % lum
    if lum > 215:
        return 'too bright / blown out (mean %.0f)' % lum
    return ''


def lift(img, target=42.0):
    """Generated low-key scenes often come back nearly black; gamma-lift the subject region to a readable exposure
    (highlights are preserved, so red charts / glowing helixes stay punchy)."""
    g = np.asarray(img.convert('L')).astype(np.float32)
    m = float(g[: int(g.shape[0] * .6)].mean())
    if m >= target or m <= 1:
        return img
    gamma = max(.45, min(1.0, math.log(target / 255) / math.log(m / 255)))
    a = np.asarray(img.convert('RGB')).astype(np.float32) / 255
    return Image.fromarray((np.power(a, gamma) * 255).clip(0, 255).astype('uint8'))


# ---------- 9:16 fitting ----------
def fit_portrait(img, W=1080, H=1920, top_frac=.03):
    """Landscape scene -> 9:16 keeping the most detailed vertical band (the subject), extended top/bottom with the
    image's own edge tones, subject in the upper half. Portrait images are just cover-cropped."""
    img = img.convert('RGB'); w, h = img.size
    if 0.75 < w / h <= 1.25:
        # square-ish (Workers AI flux-1-schnell returns 1024x1024): keep the full frame at full width, high in the canvas,
        # so the subject sits above the headline band; extend above/below with the image's own edge tones
        # slight push-in (1.12x, centered crop) and the image's center (where flux puts the subject) at ~30% of the
        # frame height, so the subject sits in the upper half, clear of the headline band (y 900-1520)
        s = 1.12 * W / w; im = img.resize((int(w * s + .5), int(h * s + .5)), Image.LANCZOS)
        l = (im.width - W) // 2; im = im.crop((l, 0, l + W, im.height)); a = np.asarray(im).astype(np.float32)
        hh = a.shape[0]; top = max(0, int(H * .30 - hh / 2)); c = np.zeros((H, W, 3), np.float32)
        tb, bb = a[:20].mean((0, 1)), a[-40:].mean((0, 1))
        c[:top] = tb; c[top:top + hh] = a[:H - top]; c[top + hh:] = bb
        f = 90
        for i in range(f):
            t = i / f
            if top: c[top + i] = tb * (1 - t) + a[i] * t
            if top + hh <= H: c[top + hh - f + i] = a[hh - f + i] * (1 - t) + bb * t
        c += np.random.default_rng(1).normal(0, 2.5, c.shape)
        return Image.fromarray(c.clip(0, 255).astype('uint8')).filter(ImageFilter.UnsharpMask(2, 50, 2))
    if w / h <= 0.75:
        s = max(W / w, H / h); im = img.resize((int(w * s + .5), int(h * s + .5)), Image.LANCZOS)
        l, t = (im.width - W) // 2, int((im.height - H) * .35)
        return im.crop((l, t, l + W, t + H))
    cw = min(w, int(h * .74))  # band ~ head-to-monitor width used on the approved covers
    g = np.asarray(img.convert('L')).astype(np.float32)
    energy = np.abs(np.diff(g, axis=1)).sum(0) + np.abs(np.diff(g, axis=0)).sum(0)[:-1]
    win = np.convolve(energy, np.ones(cw), 'valid')
    x0 = int(np.argmax(win)) if len(win) else 0
    a = np.asarray(img.crop((x0, 0, x0 + cw, h))).astype(np.float32)
    ch = int(cw * 16 / 9); top = int(ch * top_frac)
    c = np.zeros((ch, cw, 3), np.float32)
    tb, bb = a[:20].mean((0, 1)), a[-40:].mean((0, 1))
    c[:top] = tb; c[top:top + h] = a[:ch - top]; c[top + h:] = bb
    f = max(1, int(h * .08))
    for i in range(min(f, h)):
        t = i / f
        if top:
            c[top + i] = tb * (1 - t) + a[i] * t
        if top + h <= ch:
            c[top + h - f + i] = a[h - f + i] * (1 - t) + bb * t
    c += np.random.default_rng(1).normal(0, 3.0, c.shape)
    out = Image.fromarray(c.clip(0, 255).astype('uint8')).resize((W, H), Image.LANCZOS)
    return out.filter(ImageFilter.UnsharpMask(2, 60, 2))


# ---------- sources ----------
def generated(post, timeout=120):
    if os.environ.get('AIFEED_SCENE_GEN', 'on').lower() in ('off', '0', 'false'):
        return None, 'disabled'
    prompt = scene_prompt(post)
    seed = int(hashlib.sha1((post.get('slug') or prompt).encode()).hexdigest()[:6], 16)
    u = ('https://image.pollinations.ai/prompt/' + urllib.parse.quote(prompt) +
         f'?width=1080&height=1920&nologo=true&seed={seed}&model=flux')
    try:
        r = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=timeout)
        if 'image' not in (r.headers.get('content-type') or ''):
            return None, 'not an image'
        img = Image.open(io.BytesIO(r.read())); img.load()
    except Exception as e:  # 402 = free per-IP queue busy; never pay, just fall through
        return None, str(e)[:120]
    img = img.convert('RGB')
    return img.crop((0, 0, img.width, int(img.height * .95))), ''  # drop the free-tier watermark strip at the bottom


def cloudflare(post, timeout=90):
    """Cloudflare Workers AI flux-1-schnell. Only runs when CF_ACCOUNT_ID + CF_API_TOKEN are set (not set today).
    On the Workers Free plan the 10k neurons/day allowance (~170 images) simply errors when used up: it cannot bill."""
    acct, tok = os.environ.get('CF_ACCOUNT_ID'), os.environ.get('CF_API_TOKEN')
    if not acct or not tok:
        return None, 'no CF_ACCOUNT_ID/CF_API_TOKEN'
    body = json.dumps({'prompt': scene_prompt(post)[:2000], 'steps': 8}).encode()
    req = urllib.request.Request(f'https://api.cloudflare.com/client/v4/accounts/{acct}/ai/run/@cf/black-forest-labs/flux-1-schnell',
                                 data=body, headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'})
    try:
        try:
            j = json.load(urllib.request.urlopen(req, timeout=timeout))
        except urllib.error.HTTPError as e:  # 400 = prompt flagged / bad input: log Cloudflare's reason, never retry paid
            return None, f'HTTP {e.code} ' + e.read()[:160].decode('utf8', 'ignore')
        import base64
        img = Image.open(io.BytesIO(base64.b64decode(j['result']['image']))); img.load()
        return img.convert('RGB'), ''
    except Exception as e:
        return None, str(e)[:120]


def story_photo(photo):
    if not photo:
        return None, 'none'
    try:
        if re.match(r'https?://', photo):
            req = urllib.request.Request(photo, headers={'User-Agent': 'Mozilla/5.0 (aifeed.run reels)'})
            img = Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=30).read()))
        else:
            img = Image.open(photo)
        img.load(); return img.convert('RGB'), ''
    except Exception as e:
        return None, str(e)[:120]


def clean(s):
    import html
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s or ''))).strip()


def commons(queries, used=()):
    for q in queries:
        u = ('https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=15'
             '&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1600&gsrsearch=' + urllib.parse.quote(q + ' filetype:bitmap'))
        try:
            pages = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=20)).get('query', {}).get('pages', {})
        except Exception as e:
            print('commons search failed:', e, file=sys.stderr); continue
        for pg in sorted(pages.values(), key=lambda p: p.get('index', 99)):
            ii = (pg.get('imageinfo') or [{}])[0]; m = ii.get('extmetadata', {})
            lic = clean(m.get('LicenseShortName', {}).get('value', ''))
            if not FREE_LICENSES.match(lic) or ii.get('width', 0) < 1200 or pg['title'] in used or not re.search(r'\.jpe?g$', pg['title'], re.I):
                continue
            try:
                img = Image.open(io.BytesIO(urllib.request.urlopen(urllib.request.Request(ii['thumburl'], headers=UA), timeout=30).read()))
                img.load()
            except Exception:
                continue
            if gate(img.convert('RGB')):
                continue
            artist = clean(m.get('Artist', {}).get('value', '')) or 'Wikimedia Commons'
            return img.convert('RGB'), f"Photo: {artist[:60]} / {lic} via Wikimedia Commons ({ii.get('descriptionurl', '')})"
    return None, ''


def pick_scene(post, photo=None, feed=None, log=None):
    """Returns (9:16 PIL image, credit, source). Raises SystemExit if nothing real is usable (never a text-only Reel)."""
    log = log if log is not None else []
    order = [s.strip() for s in os.environ.get('AIFEED_SCENE_ORDER', 'cloudflare,generated,story,commons,feed').split(',') if s.strip()]
    for src in order:
        credit = ''
        if src == 'cloudflare':
            img, why = cloudflare(post)
            img = lift(img) if img is not None else img
        elif src == 'generated':
            img, why = generated(post)
            img = lift(img) if img is not None else img
        elif src == 'story':
            img, why = story_photo(photo or post.get('photoUrl'))
        elif src == 'commons':
            img, credit = commons(scene_keywords(post)); why = '' if img is not None else 'no theme match'
        elif src == 'feed' and feed is not None:
            img = feed.convert('RGB').crop((0, 130, feed.width, int(feed.height * .53))); why = ''
        else:
            continue
        dbg = os.environ.get('AIFEED_SCENE_DEBUG')
        if dbg and img is not None:
            os.makedirs(dbg, exist_ok=True); img.save(os.path.join(dbg, f"{post.get('slug', 'scene')}_{src}.jpg"), quality=90)
        reason = why or gate(img)
        if not reason:
            fitted = fit_portrait(img)
            reason = gate(fitted)
            if not reason:
                log.append(f'{src}: ok'); print(f'scene: {src} ok', file=sys.stderr)
                return fitted, credit, src
        log.append(f'{src}: {reason}'); print(f'scene: {src} rejected ({reason})', file=sys.stderr)
    raise SystemExit('no usable scene (' + '; '.join(log) + '); refusing a text-only Reel')
