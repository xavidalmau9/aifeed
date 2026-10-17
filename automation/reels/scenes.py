"""Story-themed scene picker for AIFeed Reels (free sources only, never anything that can bill).

Cascade (first one that passes its quality gate wins):
  0. cache       - a raw scene already rendered for this slug (AIFEED_SCENE_CACHE dir; samples/tests only)
  1. cloudflare  - Workers AI flux-1-schnell; ONLY when AIFEED_SCENE_CF=on (the live autopilot sets it; samples, dry runs
                   and manual renders never do, so they cannot drain the free 10k neurons/day). A dark scene is lifted; a
                   scene that came back but failed the gate is retried once with a brighter prompt (not on 429/errors).
  2. ovh         - OVHcloud AI Endpoints SDXL, anonymous (no account, no key, no card; 2 requests/min per IP) with a
                   negative prompt against text/people. Disable with AIFEED_SCENE_OVH=off.
  3. generated   - Pollinations' keyless endpoint (unreliable: 402 when busy; disable with AIFEED_SCENE_GEN=off)
  4. library     - a bundled pre-made dramatic scene for the story's theme (automation/reels/library); always available,
                   so it comes BEFORE the photo tiers (Javier's call: a ready-made dramatic scene beats a weak photo)
  5. story       - the story's own photo, only if it is a real photo, not a screenshot, and not posed people
  6. openverse   - Openverse scene search on the AI's scene keywords + theme keywords (CC0/PDM/CC BY/CC BY-SA)
  7. commons     - Wikimedia Commons scene search on the same keywords
                   (5-7 are only reached if the library is missing; set AIFEED_SCENE_ORDER to put photos earlier)
Photo sources (story/openverse/commons/feed) also reject posed people: titles like 'visits', 'meets', 'Secretary',
'portrait', 'handshake' and a cheap skin-area heuristic.
Every accepted scene is fitted to 9:16 with the subject kept in the upper half (above the headline band).
"""
import hashlib, io, json, math, os, re, sys, urllib.error, urllib.parse, urllib.request
import numpy as np
from PIL import Image, ImageFilter

UA = {'User-Agent': 'aifeed-reels/1.0 (https://aifeed.run)'}
HERE = os.path.dirname(os.path.abspath(__file__))
LIB_DIR = os.path.join(HERE, 'library')
FREE_LICENSES = re.compile(r'^(CC0|Public domain|CC BY(-SA)? [0-9.]+|No restrictions)$', re.I)
STYLE = ('photorealistic cinematic editorial news photograph, dramatic low-key lighting, deep shadows, rim light, '
         'shallow depth of field, the main subject clearly lit and readable, centered horizontally in the upper half of the frame, '
         'the lower part of the frame falls off into dark shadow, completely text-free image: no text, no letters, no numbers, '
         'no digits, no words, no signage, no signs, no labels, no name plates, no lecterns or podiums, no laptops, no posters, '
         'no logos, no brand marks, no watermark, any screen shows only abstract glowing lines on black with nothing written on it, '
         'no recognizable real person, people only as silhouettes or seen from behind, 35mm film grain')
# retry variant when the first Cloudflare scene is too dark: same subject, brighter key light (still moody, still text-free)
BRIGHT_STYLE = STYLE.replace('dramatic low-key lighting, deep shadows, rim light',
                             'dramatic but bright lighting, a strong warm key light fully illuminating the subject, glowing highlights, '
                             'medium exposure, rim light').replace('the lower part of the frame falls off into dark shadow',
                             'the lower third of the frame is darker')
# scene descriptions that invite fake writing; such LLM scene prompts are replaced by the theme scene
TEXT_PRONE = re.compile(r'\b(signs?|signage|lecterns?|podiums?|name ?plates?|laptops?|phones?|smartphones?|documents?|papers?|'
                        r'newspapers?|headlines?|books?|posters?|banners?|billboards?|storefronts?|labels?|dashboards?|'
                        r'keyboards?|notebooks?|whiteboards?|placards?|letters?|words?|text|caption|logo|brand|ticker|'
                        r'numbers?|digits?|charts? with|spreadsheets?|tablets?|monitors? showing|screens? showing|mixing (desk|console)|consoles?)\b', re.I)

# theme rules: (regex on headline+summary, scene subject for generation, Commons keyword queries)
THEMES = [
    (r'credit default|cds|\bdebt\b|bond|default|distress|selloff|sell-off|plunge|crash|bubble|losses?\b',
     'a stressed trader seen in profile silhouette in the upper half of the frame, head in hand, rim-lit by red light, in front of a wall of blurred monitors that show only thick glowing red downward-crashing lines on pure black, the trader centered in the frame',
     ['stock market crash screen red', 'trading floor screens']),
    (r'genom|\bdna\b|gene\b|genes\b|protein|biolog|cell\b|drug discovery|alphafold',
     'a colossal glowing cyan DNA double helix hologram filling the whole upper half of the frame from edge to edge, twisting diagonally, violently glitching and fragmenting into hundreds of red and cyan shards and particles, in a vast pitch-black space, a tiny lone silhouette seen from behind far below it looking up',
     ['DNA gel electrophoresis UV', 'DNA sequencing laboratory']),
    (r'data ?cent|datacenter|server|compute|gpu cluster|coreweave|stargate|power grid|electricity',
     'a long dark data center corridor of server racks with blue status lights vanishing into the distance, a lone silhouette walking away in hard backlight',
     ['data center server racks', 'server room']),
    (r'chip|semiconductor|nvidia|tsmc|\bamd\b|wafer|export control',
     'a dramatic macro shot of a glowing processor chip on a circuit board, blank unmarked surface, red and blue light trails, filling the upper half of the frame',
     ['silicon wafer', 'computer chip macro']),
    (r'fbi|arrest|spy|espionage|lawsuit|court|judge|sued|indict|police|charges',
     'a lone man silhouette standing in a vast dark empty room, seen from behind, caught in a single hard white spotlight from above, red and blue police light streaming through window blinds behind him, long dramatic shadow, bare empty floor, no furniture',
     ['courtroom', 'police tape night']),
    (r'congress|senate|white house|regulat|law\b|bill\b|policy|government|ban\b|eu ai act',
     'the US Capitol dome at night under dramatic storm clouds and lightning, red and blue light, the dome in the upper half of the frame',
     ['United States Capitol night']),
    (r'robot|humanoid|optimus|autonomous|self-driving|waymo|drone',
     'a humanoid robot head and shoulders in a dark factory, hard rim light, looking at its own raised hand, in the upper half of the frame',
     ['humanoid robot', 'industrial robot arm']),
    (r'music|song|singer|artist|youtube|spotify|film|hollywood|actor|voice clone',
     'a large vintage chrome studio microphone, brightly lit by a single warm golden spotlight, large in the upper half of the frame, a glowing golden audio waveform floating in the dark air beside it, empty dark background, no equipment, no people',
     ['recording studio microphone', 'concert stage lights']),
    (r'phone|smartphone|iphone|pixel|call|assistant|voice',
     'a hand silhouette lit by a soft glow from below in a dark room, abstract light trails',
     ['smartphone in hand dark']),
    (r'safety|risk|danger|harm|security|hack|breach|leak|vulnerab|malware',
     'a dark room washed in pulsing red alert light, a silhouette seen from behind facing a wall of abstract red light',
     ['security operations center', 'server room red light']),
    (r'funding|raises|valuation|ipo|investor|billion|acquisition|acquire|deal',
     'a lone silhouette at the floor-to-ceiling window of a dark glass skyscraper at night overlooking a glowing city',
     ['skyscraper boardroom night', 'stock exchange']),
    (r'health|medical|hospital|doctor|patient|clinic|\bfda\b|cancer|diagnos',
     'a dark hospital corridor at night, a single gurney silhouette under a hard cold overhead light, teal and red glow, long shadows, no people',
     ['hospital corridor night', 'operating room lights']),
    (r'model|llm|chatbot|gpt|gemini|claude|grok|openai|anthropic|agent',
     'a lone silhouette seen from behind facing a towering wall of flowing neural network light, glowing threads and nodes, dark room',
     ['neural network visualization', 'computer screen code dark']),
]
# library keys, parallel to THEMES (+ 'default'); automation/reels/library/library.json maps each key to bundled scenes
THEME_KEYS = ['markets', 'genome', 'datacenter', 'chip', 'legal', 'policy', 'robot', 'music', 'device', 'security',
              'funding', 'medical', 'ai-model']
DEFAULT_THEME = ('a silhouette at a dark window overlooking glowing city lights at night',
                 ['computer screen code dark'])


def theme_for(post):
    text = ' '.join(str(post.get(k) or '') for k in ('headline', 'summary', 'title')).lower()
    for rx, subject, queries in THEMES:
        if re.search(rx, text):
            return subject, queries
    return DEFAULT_THEME


def theme_key(post):
    text = ' '.join(str(post.get(k) or '') for k in ('headline', 'summary', 'title')).lower()
    for (rx, _, _), key in zip(THEMES, THEME_KEYS):
        if re.search(rx, text):
            return key
    return 'default'


def scene_prompt(post, bright=False):
    # a curated theme scene (tuned for drama, text-free, subject high in the frame) wins; the LLM scene is used only for
    # stories no theme covers, and never when it asks for things that carry writing
    subject = theme_for(post)[0]
    p = (post.get('scenePrompt') or '').strip()
    if subject != DEFAULT_THEME[0] or not p or TEXT_PRONE.search(p):
        p = subject
    return p + ', ' + (BRIGHT_STYLE if bright else STYLE)


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
    kept = []
    for w in words:  # never repeat a root word on the cover (e.g. "AI ... AI", "stress ... distress")
        if not repeated_roots(' '.join(kept + [w])):
            kept.append(w)
    words = kept
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


STOPW = {'a', 'an', 'the', 'of', 'to', 'for', 'in', 'on', 'at', 'by', 'and', 'or', 'with', 'as', 'is', 'are', 'its', 'from', 'over', 'into'}


def word_root(w):
    """'distress' and 'stress' share a root; 'tags'/'tagged' -> 'tag'; 'AI' -> 'ai' (mirrors reelbrief.js)."""
    r = re.sub(r'[^a-z0-9]', '', str(w).lower())
    m = re.match(r'^(dis|un|re|non|over|under|mis)(.{4,})$', r)
    if m:
        r = m.group(2)
    for suf in ('ings', 'ing', 'ed', 'es', 's', 'ly', 'er'):
        if len(r) - len(suf) >= 3 and r.endswith(suf):
            r = r[:-len(suf)]; break
    return re.sub(r'(.)\1$', r'\1', r)


def same_root(a, b):
    if a == b:
        return True
    s, l = sorted((a, b), key=len)
    if len(s) < 4 or not (l.startswith(s) or l.endswith(s)):
        return False
    return len(s) >= 5 or len(l) - len(s) <= 3


def repeated_roots(p):
    seen, rep = [], []
    for w in re.split(r'[\s\-]+', re.sub(r'[*/]', ' ', str(p or ''))):
        raw = re.sub(r'[^a-z0-9]', '', w.lower())
        if not raw or raw in STOPW:
            continue
        r = word_root(w)
        if any(same_root(x, r) for x in seen):
            rep.append(w)
        else:
            seen.append(r)
    return rep


def valid_punch(p):
    if not isinstance(p, str):
        return False
    lines = [l.strip() for l in p.split('/') if l.strip()]
    return 2 <= len(lines) <= 4 and sum(l.startswith('*') for l in lines) == 1 and all(len(l.lstrip('*')) <= 22 for l in lines) \
        and not re.search(r'\bdaily\b|edited', p, re.I) and not repeated_roots(p)


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


MAX_STRETCH, MIN_GAMMA, NEAR_BLACK = 1.5, .6, 9.0


def lift(img, target=42.0):
    """Gently lift a dark generated scene: a capped highlight stretch (<= 1.5x) and a capped gamma (>= 0.6), so noise and
    JPEG blocks are never amplified into blotches. Near-black scenes (subject-region mean < 9) are returned unchanged:
    the gate rejects them and pick_scene asks Cloudflare again with the brighter prompt instead of over-lifting."""
    a = np.asarray(img.convert('RGB')).astype(np.float32) / 255
    m = float(a[: int(a.shape[0] * .6)].mean()) * 255
    if m >= target or m < NEAR_BLACK:
        return img
    hi = float(np.percentile(a.max(2), 99.5))
    if hi < .85:
        a = (a * min(MAX_STRETCH, .9 / max(hi, .05))).clip(0, 1)
        m = float(a[: int(a.shape[0] * .6)].mean()) * 255
    if m < target:
        gamma = max(MIN_GAMMA, min(1.0, math.log(target / 255) / math.log(max(m, .5) / 255)))
        a = np.power(a, gamma)
    return Image.fromarray((a * 255).clip(0, 255).astype('uint8'))


def flat_fraction(img):
    """Share of mid-tone blocks with no texture (UI screenshots, phone mockups, graphic cards). Real photos ~0-0.3."""
    g = np.asarray(img.convert('L').resize((512, max(16, int(512 * img.height / img.width))))).astype(np.float32)
    g = g[: int(g.shape[0] * .8)]
    C = 16; n = f = 0
    for i in range(0, g.shape[0] - C + 1, C):
        for j in range(0, 512 - C + 1, C):
            b = g[i:i + C, j:j + C]; n += 1
            f += b.std() < 2.5 and b.mean() > 35
    return f / max(n, 1)


POSED = re.compile(r'\b(visit(s|ed|ing)?|meets?|meeting|secretary|minister|president|governor|senator|congress(man|woman)|mayor|'
                   r'ambassador|chairman|chairwoman|ceo|founder|portrait|headshot|head shot|handshake|shak(es|ing) hands|'
                   r'pose[sd]?|posing|ceremony|signing|delegation|press conference|speaks?|speaking|speech|interview|award|'
                   r'summit|official photo|greets?|tours?|toured|welcomes?|delivers? remarks|keynote|panel)\b', re.I)


# photos that are really charts, documents, scans or graphics (they carry text/numbers)
GRAPHIC = re.compile(r'\b(chart|graph|diagram|plot|map|screenshot|screen ?shot|infographic|logo|poster|document|scan|'
                     r'microscop\w*|afm|sem image|texture|pattern|wallpaper|render(ing)?|illustration|vector|icon|sign)s?\b', re.I)


def skin_fraction(img):
    """Share of solid skin-tone area (YCbCr rule, 3x3 eroded). Posed press photos / portraits ~0.02-0.17; scenes ~0-0.01."""
    im = img.convert('RGB'); im.thumbnail((256, 256))
    y, cb, cr = [np.asarray(c).astype(np.float32) for c in im.convert('YCbCr').split()]
    r, g, b = [np.asarray(c).astype(np.float32) for c in im.split()]
    m = (cb >= 80) & (cb <= 125) & (cr >= 138) & (cr <= 170) & (y > 70) & (r > g) & (r > b) & ((r - g) > 12)
    m = np.asarray(Image.fromarray((m * 255).astype('uint8')).filter(ImageFilter.MinFilter(3))) > 0
    return float(m.mean())


def saturation(img):
    im = img.convert('RGB'); im.thumbnail((256, 256)); a = np.asarray(im).astype(np.float32) / 255
    mx, mn = a.max(2), a.min(2)
    return float(np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-3), 0).mean())


def posed_reason(img, title=''):
    """'' if the photo is not posed people. title = file name / title / tags of the photo when known."""
    t = re.sub(r'[_\-]+', ' ', title or '')
    m = POSED.search(t)
    if m:
        return f'posed/people photo ("{m.group(0)}" in title)'
    m = GRAPHIC.search(t)
    if m:
        return f'graphic, not a scene ("{m.group(0)}" in title)'
    if img is None:
        return ''
    if saturation(img) < .15:  # black & white / desaturated: the skin check can't see people, so don't trust it
        return 'near-greyscale photo (people check not possible)'
    sf = skin_fraction(img)
    return 'people in frame (skin %.3f)' % sf if sf > .02 else ''


def photo_gate(img):
    """Stricter gate for non-generated photos (story og:image, Commons, feed crop): also rejects screenshots/mockups."""
    reason = gate(img)
    if reason:
        return reason
    ff = flat_fraction(img)
    return 'flat / screenshot-like (%.2f flat)' % ff if ff > .4 else posed_reason(img)


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
        l = (im.width - W) // 2; up = max(0, int(im.height / 2 - H * .27))  # image center at ~27% of the frame height
        im = im.crop((l, up, l + W, im.height)); a = np.asarray(im).astype(np.float32)
        hh = a.shape[0]; top = 0; c = np.zeros((H, W, 3), np.float32)
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
def generated(post, timeout=60):
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


def cf_enabled():
    """Cloudflare's free daily allowance is shared by everything; only the live autopilot turns it on."""
    return os.environ.get('AIFEED_SCENE_CF', 'off').strip().lower() in ('on', '1', 'true', 'yes')


def cloudflare(post, timeout=90, bright=False):
    """Cloudflare Workers AI flux-1-schnell. Only runs when AIFEED_SCENE_CF=on and CF_ACCOUNT_ID + CF_API_TOKEN are set.
    On the Workers Free plan the 10k neurons/day allowance (~170 images) simply errors when used up: it cannot bill."""
    if not cf_enabled():
        return None, 'off (AIFEED_SCENE_CF is not on)'
    acct, tok = os.environ.get('CF_ACCOUNT_ID'), os.environ.get('CF_API_TOKEN')
    if not acct or not tok:
        return None, 'no CF_ACCOUNT_ID/CF_API_TOKEN'
    body = json.dumps({'prompt': scene_prompt(post, bright)[:2000], 'steps': 8}).encode()
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


SDXL_STYLE = ('photorealistic cinematic editorial news photograph, dramatic low-key lighting, rim light, deep shadows, '
              'subject in the upper half of the frame, dark lower third, 35mm film grain, highly detailed')
SDXL_NEG = ('text, letters, words, numbers, digits, writing, signage, sign, label, caption, logo, watermark, signature, '
            'face, portrait, close-up of a person, crowd, cartoon, illustration, drawing, graphic, 3d render, lowres, blurry, deformed, '
            'frame, border, white border, polaroid, vignette frame, bright overexposed')
OVH_URL = 'https://stable-diffusion-xl.endpoints.kepler.ai.cloud.ovh.net/api/text2image'


def sdxl_prompt(post):
    subject = scene_prompt(post).split(', photorealistic')[0]
    return subject + ', ' + SDXL_STYLE


def ovh(post, timeout=60, tries=3, wait=31):
    """OVHcloud AI Endpoints SDXL, anonymous: no account, no key, no card (2 requests/min per IP; 429 when exceeded).
    The anonymous endpoint sometimes drops the connection, so try up to 3 times (waiting out the per-minute limit)."""
    if os.environ.get('AIFEED_SCENE_OVH', 'on').lower() in ('off', '0', 'false'):
        return None, 'disabled'
    import time
    body = json.dumps({'prompt': sdxl_prompt(post), 'negative_prompt': SDXL_NEG}).encode()
    why = ''
    for i in range(tries):
        req = urllib.request.Request(OVH_URL, data=body, headers=dict(UA, **{'Content-Type': 'application/json', 'accept': 'application/octet-stream'}))
        try:
            img = Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=timeout).read())); img.load()
            return img.convert('RGB'), ''
        except urllib.error.HTTPError as e:
            why = f'HTTP {e.code} ' + e.read()[:120].decode('utf8', 'ignore')
            if e.code not in (429, 500, 502, 503, 504):
                break
        except Exception as e:
            why = str(e)[:120]
        if i < tries - 1:
            time.sleep(wait if '429' in why else min(5, wait))
    return None, why


def cached(post):
    """Samples/tests: reuse a raw scene already rendered for this slug instead of generating (never touches a quota)."""
    d = os.environ.get('AIFEED_SCENE_CACHE')
    if not d or not os.path.isdir(d):
        return None, 'no cache'
    slug = post.get('slug') or ''
    names = sorted(f for f in os.listdir(d) if f.startswith(slug + '_') and f.lower().endswith(('.jpg', '.jpeg', '.png')))
    pref = [f for f in names if 'cloudflare' in f or 'ovh' in f] or [f for f in names if 'library' not in f]
    if not pref:
        return None, 'no cached scene for ' + slug
    img = Image.open(os.path.join(d, pref[0])); img.load()
    return img.convert('RGB'), ''


def library(post):
    """Bundled pre-made dramatic scenes (automation/reels/library), chosen by the story's theme; always available."""
    try:
        man = json.load(open(os.path.join(LIB_DIR, 'library.json')))
    except Exception as e:
        return None, 'no library (%s)' % str(e)[:60]
    key = theme_key(post)
    files = [e['file'] for e in man.get('scenes', []) if e.get('key') == key] or \
            [e['file'] for e in man.get('scenes', []) if e.get('key') == 'default']
    if not files:
        return None, 'no library scene for ' + key
    f = files[int(hashlib.sha1((post.get('slug') or key).encode()).hexdigest()[:6], 16) % len(files)]
    img = Image.open(os.path.join(LIB_DIR, f)); img.load()
    return img.convert('RGB'), ''


QSTOP = {'a', 'an', 'the', 'of', 'in', 'on', 'and', 'or', 'with', 'for', 'to', 'at', 'by', 'from', 'abstract', 'digital',
         'visualization', 'technology', 'concept', 'photo', 'image', 'dark', 'night', 'red', 'blue', 'light', 'lights'}


def relevant(query, text):
    """A photo must actually show the scene: enough of the query's content words appear in its title/tags/description."""
    words = [w for w in re.findall(r'[a-z]+', query.lower()) if w not in QSTOP and len(w) > 2]
    t = ' ' + ' '.join(word_root(w) for w in re.findall(r'[a-z]+', (text or '').lower())) + ' '
    hits = sum(1 for w in words if ' ' + word_root(w) + ' ' in t)
    return hits >= min(2, len(words)) if words else False


OV_LICENSES = {'cc0': 'CC0', 'pdm': 'Public domain', 'by': 'CC BY', 'by-sa': 'CC BY-SA'}


def openverse(queries, used=()):
    """Openverse (anonymous API) scene search; only CC0 / public domain / CC BY / CC BY-SA, no posed people."""
    for q in queries:
        u = ('https://api.openverse.org/v1/images/?page_size=12&license=cc0,pdm,by,by-sa&category=photograph&mature=false&q=' + urllib.parse.quote(q))
        try:
            res = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=20)).get('results', [])
        except Exception as e:
            print('openverse search failed:', str(e)[:80], file=sys.stderr); continue
        for r in res:
            title = ' '.join([r.get('title') or '', ' '.join(t.get('name', '') for t in (r.get('tags') or [])[:12]), r.get('url') or ''])
            if (r.get('width') or 0) < 1000 or r.get('url') in used or posed_reason(None, title) \
                    or not relevant(q, title):
                continue
            try:
                img = Image.open(io.BytesIO(urllib.request.urlopen(urllib.request.Request(r['url'], headers=UA), timeout=30).read()))
                img.load(); img = img.convert('RGB')
            except Exception:
                continue
            if photo_gate(img):
                continue
            lic = OV_LICENSES.get(r.get('license', ''), '')
            lic = (lic + ' ' + (r.get('license_version') or '')).strip() if lic.startswith('CC BY') else lic
            who = clean(r.get('creator') or '') or 'Openverse'
            return img, f"Photo: {who[:60]} / {lic} via Openverse ({r.get('foreign_landing_url', '')})"
    return None, ''


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
            desc = clean(m.get('ImageDescription', {}).get('value', ''))[:300]
            if posed_reason(None, pg['title'] + ' ' + desc) or not relevant(q, pg['title'] + ' ' + desc) \
                    or photo_gate(img.convert('RGB')):
                continue
            artist = clean(m.get('Artist', {}).get('value', '')) or 'Wikimedia Commons'
            return img.convert('RGB'), f"Photo: {artist[:60]} / {lic} via Wikimedia Commons ({ii.get('descriptionurl', '')})"
    return None, ''


DEFAULT_ORDER = 'cache,cloudflare,ovh,generated,library,story,openverse,commons'  # ready-made library before photos
GENERATED = ('cloudflare', 'cloudflare-bright', 'ovh', 'generated', 'cache')


def pick_scene(post, photo=None, feed=None, log=None):
    """Returns (9:16 PIL image, credit, source). The bundled library makes this always succeed; raises SystemExit only
    if even the library is missing (never a text-only Reel)."""
    log = log if log is not None else []
    order = [s.strip() for s in os.environ.get('AIFEED_SCENE_ORDER', DEFAULT_ORDER).split(',') if s.strip()]
    dbg = os.environ.get('AIFEED_SCENE_DEBUG')
    attempts = []
    for src in order:
        attempts += [('cloudflare', False), ('cloudflare-bright', True)] if src == 'cloudflare' else [(src, None)]
    cf_image = False  # the bright retry only makes sense when Cloudflare returned an image that failed the gate
    for src, bright in attempts:
        credit = ''
        if src == 'cache':
            if not os.environ.get('AIFEED_SCENE_CACHE'):
                continue
            img, why = cached(post)
        elif src.startswith('cloudflare'):
            if bright and not cf_image:
                continue
            img, why = cloudflare(post, bright=bright)
            cf_image = img is not None
            img = lift(img) if img is not None else img
        elif src == 'ovh':
            img, why = ovh(post)
            img = lift(img) if img is not None else img
        elif src == 'generated':
            img, why = generated(post)
            img = lift(img) if img is not None else img
        elif src == 'story':
            ref = photo or post.get('photoUrl') or ''
            img, why = story_photo(ref)
            if img is not None and not why:  # e.g. 'Secretary_of_State_..._visits_Anthropic.jpg' picked as the story photo
                why = posed_reason(None, urllib.parse.unquote(os.path.basename(urllib.parse.urlparse(str(ref)).path)) + ' ' +
                                   str(post.get('photoTitle') or ''))
        elif src == 'openverse':
            img, credit = openverse(scene_keywords(post)); why = '' if img is not None else 'no scene match'
        elif src == 'commons':
            img, credit = commons(scene_keywords(post)); why = '' if img is not None else 'no scene match'
        elif src == 'library':
            img, why = library(post)
        elif src == 'feed' and feed is not None:
            img = feed.convert('RGB').crop((0, 130, feed.width, int(feed.height * .53))); why = ''
        else:
            continue
        if dbg and img is not None:
            os.makedirs(dbg, exist_ok=True); img.save(os.path.join(dbg, f"{post.get('slug', 'scene')}_{src}.jpg"), quality=90)
        check = gate if src in GENERATED or src == 'library' else photo_gate
        reason = why or check(img)
        if not reason:
            fitted = fit_portrait(img)
            reason = gate(fitted)
            if not reason:
                log.append(f'{src}: ok'); print(f'scene: {src} ok', file=sys.stderr)
                return fitted, credit, src
        log.append(f'{src}: {reason}'); print(f'scene: {src} rejected ({reason})', file=sys.stderr)
    raise SystemExit('no usable scene (' + '; '.join(log) + '); refusing a text-only Reel')
