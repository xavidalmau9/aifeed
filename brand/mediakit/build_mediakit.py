#!/usr/bin/env python3
"""Builds AIFeed_MediaKit.pdf (2 pages, US Letter) in the AIFeed.run brand look.

Usage:  python3 brand/mediakit/build_mediakit.py [output.pdf]
Needs:  pip install reportlab ; Poppins TTFs (Google Fonts). Set POPPINS_DIR if they are not
        in one of the default font folders below.

Copy follows the brand standard: AIFeed.run / "AIFeed.run AI News" (no pipe), tagline
"The AI news that matters.", subline "Top AI stories, explained in 60 seconds.",
CTA "Free weekly AI brief at aifeed.run". Newsletter is weekly. No human-editing claims.
Numbers in SNAPSHOT are dated; update them (or set SNAPSHOT = None) when rebuilding.
"""
import glob, os, random, sys
from reportlab.lib.colors import Color, HexColor
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

OUT = sys.argv[1] if len(sys.argv) > 1 else 'AIFeed_MediaKit.pdf'
W, H = letter

# ---- brand ---------------------------------------------------------------------------------
BG      = HexColor('#120C2D')   # end card background
GLOW    = HexColor('#2F1663')   # end card radial glow
CARD    = HexColor('#1A1238')
PURPLE  = HexColor('#A050FF')
ORANGE  = HexColor('#FF8C00')
GREEN   = HexColor('#32D76E')
RED_OR  = HexColor('#E8501E')   # gradient start (FOLLOW button / pills)
MAGENTA = HexColor('#B624D6')   # gradient end
WHITE   = HexColor('#FFFFFF')
TEXT    = HexColor('#D9D4EC')
MUTED   = HexColor('#8F88AE')
DIM     = HexColor('#6E6890')

EMAIL   = 'theaifeed.run@gmail.com'
SITE    = 'aifeed.run'
IG      = '@aifeed.run'
FB_URL  = 'https://www.facebook.com/profile.php?id=61594868144059'
YEAR    = '2026'
# Dated, verified figures (Instagram via Graph API; site from _posts/posts-index.json).
SNAPSHOT = ('Oct 8, 2026', [('985', 'Instagram followers'), ('242', 'Instagram posts'),
                            ('204', 'stories on aifeed.run')])

# ---- fonts ---------------------------------------------------------------------------------
def find_font(name):
    dirs = [os.environ.get('POPPINS_DIR', ''), '/usr/share/fonts/truetype/sand-box/google/Poppins',
            '/usr/share/fonts/truetype/google-fonts', '/usr/share/fonts', os.path.expanduser('~/Library/Fonts'),
            '/Library/Fonts', os.path.expanduser('~/.fonts')]
    for d in dirs:
        if d:
            hits = glob.glob(os.path.join(d, '**', f'Poppins-{name}.ttf'), recursive=True)
            if hits:
                return hits[0]
    sys.exit(f'Poppins-{name}.ttf not found; set POPPINS_DIR')

for w in ('Light', 'Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold'):
    pdfmetrics.registerFont(TTFont(f'P-{w}', find_font(w)))

# ---- helpers -------------------------------------------------------------------------------
def tw(t, f, s): return pdfmetrics.stringWidth(t, f, s)

def text(c, x, y, t, f, s, col, align='left', track=0):
    c.setFillColor(col); c.setFont(f, s)
    if track:
        width = tw(t, f, s) + track * (len(t) - 1)
        if align == 'center': x -= width / 2
        elif align == 'right': x -= width
        c.saveState()
        to = c.beginText(x, y); to.setFont(f, s); to.setCharSpace(track); to.textOut(t); c.drawText(to)
        c.restoreState()
        return width
    {'left': c.drawString, 'center': c.drawCentredString, 'right': c.drawRightString}[align](x, y, t)
    return tw(t, f, s)

def runs(c, x, y, parts, s, align='left'):
    """parts: [(text, font, color)] drawn on one baseline."""
    total = sum(tw(t, f, s) for t, f, _ in parts)
    if align == 'center': x -= total / 2
    for t, f, col in parts:
        c.setFont(f, s); c.setFillColor(col); c.drawString(x, y, t); x += tw(t, f, s)
    return total

def wrap(t, f, s, width):
    lines, cur = [], ''
    for word in t.split():
        trial = (cur + ' ' + word).strip()
        if tw(trial, f, s) <= width: cur = trial
        else: lines.append(cur); cur = word
    if cur: lines.append(cur)
    return lines

def para(c, x, y, t, f, s, col, width, lead):
    c.setFont(f, s); c.setFillColor(col)
    for ln in wrap(t, f, s, width):
        c.drawString(x, y, ln); y -= lead
    return y

def grad_rect(c, x, y, w, h, r=0, c0=RED_OR, c1=MAGENTA, vertical=False):
    c.saveState()
    p = c.beginPath()
    if r: p.roundRect(x, y, w, h, r)
    else: p.rect(x, y, w, h)
    c.clipPath(p, stroke=0, fill=0)
    if vertical: c.linearGradient(x, y + h, x, y, (c0, c1), extend=True)
    else: c.linearGradient(x, y, x + w, y, (c0, c1), extend=True)
    c.restoreState()

def pill(c, cx, y, t, s=8.5, padx=14, h=21):
    w = tw(t, 'P-Bold', s) + 1.4 * (len(t) - 1) + 2 * padx
    grad_rect(c, cx - w / 2, y, w, h, h / 2)
    text(c, cx, y + h / 2 - s * 0.36, t, 'P-Bold', s, WHITE, 'center', track=1.4)

def background(c, glow_y, glow_r):
    c.setFillColor(BG); c.rect(0, 0, W, H, stroke=0, fill=1)
    c.saveState()
    p = c.beginPath(); p.rect(0, 0, W, H); c.clipPath(p, stroke=0, fill=0)
    c.radialGradient(W / 2, glow_y, glow_r, (GLOW, BG), (0, 1), extend=True)
    c.restoreState()
    rnd = random.Random(7 + int(glow_y))
    c.saveState()
    for _ in range(140):   # faint star field, as on the end card
        a = rnd.uniform(0.08, 0.35)
        c.setFillColor(Color(1, 1, 1, alpha=a))
        c.circle(rnd.uniform(0, W), rnd.uniform(0, H), rnd.uniform(0.25, 0.7), stroke=0, fill=1)
    c.restoreState()

def gradient_rule(c, x, y, w, h=1.2):
    grad_rect(c, x, y, w, h, 0, PURPLE, ORANGE)

def section(c, x, y, t, col=ORANGE):
    text(c, x, y, t, 'P-SemiBold', 9, col, track=1.6)

def wordmark(c, cx, y, s):
    return runs(c, cx, y, [('ai', 'P-Bold', PURPLE), ('feed', 'P-Bold', ORANGE), ('.run', 'P-Bold', WHITE)], s, 'center')

def footer(c):
    gradient_rule(c, 0, 46, W, 0.8)
    x = 54
    for i, (t, url) in enumerate([(SITE, 'https://aifeed.run'), (IG, 'https://instagram.com/aifeed.run'),
                                  (EMAIL, 'mailto:' + EMAIL)]):
        if i: x += text(c, x, 24, '  ·  ', 'P-Regular', 8, DIM)
        w = text(c, x, 24, t, 'P-Regular', 8, MUTED)
        c.linkURL(url, (x, 20, x + w, 33), relative=0); x += w
    runs(c, W - 54 - tw(f'{YEAR} Media Kit', 'P-SemiBold', 8), 24,
         [(f'{YEAR} ', 'P-SemiBold', ORANGE), ('Media Kit', 'P-SemiBold', ORANGE)], 8)

def rrect(c, x, y, w, h, r, fill, stroke=None, sw=0.9, alpha=1):
    c.saveState()
    c.setFillColor(fill, alpha=alpha)
    if stroke is not None: c.setStrokeColor(stroke); c.setLineWidth(sw)
    c.roundRect(x, y, w, h, r, stroke=1 if stroke is not None else 0, fill=1)
    c.restoreState()

M = 54                 # side margin
CW = W - 2 * M         # content width

# ---- page 1 --------------------------------------------------------------------------------
def page1(c):
    background(c, H - 60, 430)
    pill(c, W / 2, H - 92, f'AIFEED.RUN  •  MEDIA KIT  •  {YEAR}')
    wordmark(c, W / 2, H - 160, 50)
    text(c, W / 2, H - 192, 'The AI news that matters.', 'P-SemiBold', 17, WHITE, 'center')
    runs(c, W / 2, H - 212, [('Top AI stories, explained in ', 'P-Regular', TEXT),
                             ('60 seconds', 'P-SemiBold', ORANGE), ('.', 'P-Regular', TEXT)], 11, 'center')
    gradient_rule(c, M, H - 234, CW)

    y = H - 262
    section(c, M, y, 'ABOUT AIFEED.RUN')
    y -= 18
    y = para(c, M, y, 'AIFeed.run is an AI news brand covering AI models, tools, industry news, research '
             'breakthroughs and product launches. Every day we pick the top AI stories and explain each one '
             'in about 60 seconds for tech professionals, entrepreneurs, developers and creators who want to '
             'know what is happening in AI and why.', 'P-Regular', 9.3, TEXT, CW, 14)
    y -= 6
    y = para(c, M, y, 'Our pipeline is fully automated: AI finds and ranks the stories, writes each summary and '
             'fact-checks it against the original source, and every post names and links that source. We '
             'publish on our website, Instagram and Facebook (LinkedIn coming soon), plus a free weekly AI brief.',
             'P-Regular', 9.3, TEXT, CW, 14)

    y -= 18
    section(c, M, y, 'OUR REACH')
    cards = [('Daily', 'Top AI stories', PURPLE), ('Instagram', IG, ORANGE), ('Facebook', 'AIFeed.run AI News', GREEN),
             ('Weekly', 'Free AI brief · Beehiiv', PURPLE), ('aifeed.run', 'Website', ORANGE), ('LinkedIn', 'Coming soon', GREEN)]
    gap, ch = 12, 54
    cw = (CW - 2 * gap) / 3
    top = y - 12
    for i, (big, small, col) in enumerate(cards):
        r, k = divmod(i, 3)
        x0, y0 = M + k * (cw + gap), top - (r + 1) * ch - r * gap
        rrect(c, x0, y0, cw, ch, 8, CARD, col, 0.8, alpha=0.85)
        text(c, x0 + cw / 2, y0 + 25, big, 'P-Bold', 17, col, 'center')
        text(c, x0 + cw / 2, y0 + 11, small, 'P-Regular', 8, MUTED, 'center')
    links = {1: 'https://instagram.com/aifeed.run', 2: FB_URL, 4: 'https://aifeed.run'}
    for i, url in links.items():
        r, k = divmod(i, 3)
        x0, y0 = M + k * (cw + gap), top - (r + 1) * ch - r * gap
        c.linkURL(url, (x0, y0, x0 + cw, y0 + ch), relative=0)
    y = top - 2 * ch - gap

    if SNAPSHOT:
        date, stats = SNAPSHOT
        y -= 30
        sh = 22
        rrect(c, M, y - 7, CW, sh, sh / 2, CARD, HexColor('#3A2A6B'), 0.6, alpha=0.9)
        parts = []
        for i, (n, lbl) in enumerate(stats):
            if i: parts.append(('   •   ', 'P-Regular', DIM))
            parts += [(n + ' ', 'P-Bold', WHITE), (lbl, 'P-Regular', TEXT)]
        parts.append((f'   (as of {date})', 'P-Regular', MUTED))
        runs(c, W / 2, y, parts, 8.5, 'center')
        y -= 10

    y -= 26
    section(c, M, y, 'WHO WE REACH')
    y -= 18
    who = [('AI Enthusiasts', 'Early adopters following the latest AI tools and news'),
           ('Entrepreneurs', 'Business owners looking to put AI to work in their operations'),
           ('Developers', 'Technical professionals building with AI APIs and platforms'),
           ('Content Creators', 'Creators using AI for video, audio, writing and design'),
           ('Marketing Pros', 'Marketers adopting AI tools for campaigns and automation')]
    for lbl, desc in who:
        grad_rect(c, M, y + 1, 5, 5, 1.2, PURPLE, ORANGE)
        runs(c, M + 12, y, [(lbl + ':  ', 'P-SemiBold', PURPLE), (desc, 'P-Regular', TEXT)], 9)
        y -= 16
    footer(c)

# ---- page 2 --------------------------------------------------------------------------------
def page2(c):
    background(c, H + 40, 380)
    grad_rect(c, 0, H - 3, W, 3)
    text(c, M, H - 92, 'Advertising &', 'P-Bold', 24, WHITE)
    text(c, M, H - 120, 'Partnership Opportunities', 'P-Bold', 24, PURPLE)
    gradient_rule(c, M, H - 138, CW)

    offers = [
        ('Website Affiliate Placement', PURPLE,
         'Featured placement in the curated Top AI Tools section on aifeed.run. Your tool appears as an editorial '
         'card with an icon, a short description and your link, next to the day\'s top stories rather than in a '
         'banner ad. Visitors who open this section are already looking for new AI tools.',
         'Placement: Top AI Tools section  ·  Format: Editorial card with CTA'),
        ('Newsletter Sponsorship', ORANGE,
         'Sponsored placement in the free weekly AIFeed.run AI brief, sent through Beehiiv. Reach readers who '
         'signed up specifically for AI news. Sponsored mentions are clearly labeled and written in the same '
         'voice as the rest of the issue.',
         'Format: Dedicated mention  ·  Platform: Beehiiv  ·  Frequency: Weekly'),
        ('Instagram & Facebook Content', GREEN,
         'Sponsored posts or Story integrations on @aifeed.run on Instagram and on our Facebook Page, with '
         'LinkedIn coming soon. Our branded graphics (dark background, bold headlines, story-matched photos) '
         'feel native in the feed, and sponsored content is produced in the same house style and clearly labeled.',
         'Format: Branded post or Story  ·  Platforms: Instagram + Facebook (LinkedIn coming soon)'),
        ('Affiliate Partnership', PURPLE,
         'Performance-based partnerships through affiliate networks and direct programs. We can feature your '
         'affiliate link across the website, the weekly brief and social posts. We only feature tools we would '
         'recommend, and affiliate links are always disclosed.',
         'Programs: Affiliate networks + direct  ·  Disclosure: Always labeled'),
    ]
    y = H - 160
    pad, bw = 16, CW
    for title, col, body, meta in offers:
        lines = wrap(body, 'P-Regular', 8.8, bw - 2 * pad - 4)
        h = 20 + 16 + len(lines) * 12.6 + 20
        y0 = y - h
        rrect(c, M, y0, bw, h, 7, CARD, col, 0.8, alpha=0.85)
        c.saveState(); p = c.beginPath(); p.roundRect(M, y0, bw, h, 7); c.clipPath(p, stroke=0, fill=0)
        c.setFillColor(col); c.rect(M, y0, 4, h, stroke=0, fill=1); c.restoreState()
        ty = y - 22
        text(c, M + pad + 4, ty, title, 'P-SemiBold', 12, col)
        ty -= 17
        c.setFont('P-Regular', 8.8); c.setFillColor(TEXT)
        for ln in lines:
            c.drawString(M + pad + 4, ty, ln); ty -= 12.6
        text(c, M + pad + 4, ty - 2, meta, 'P-Medium', 7.6, MUTED)
        y = y0 - 12

    y -= 18
    section(c, M, y, 'GET IN TOUCH')
    y -= 18
    text(c, M, y, 'To discuss partnership opportunities, affiliate programs or custom integrations:', 'P-Regular', 9.5, TEXT)
    y -= 20
    x = M
    for i, (t, url) in enumerate([(EMAIL, f'mailto:{EMAIL}?subject=Partnership%20inquiry'), (SITE, 'https://aifeed.run'),
                                  (IG, 'https://instagram.com/aifeed.run')]):
        if i: x += text(c, x, y, '  ·  ', 'P-SemiBold', 11, DIM)
        w = text(c, x, y, t, 'P-SemiBold', 11, PURPLE)
        c.linkURL(url, (x, y - 4, x + w, y + 12), relative=0); x += w
    y -= 17
    w = runs(c, M, y, [('Facebook: ', 'P-Medium', MUTED), ('AIFeed.run AI News', 'P-Regular', TEXT),
                       ('   ·   LinkedIn: ', 'P-Medium', MUTED), ('coming soon', 'P-Regular', TEXT)], 8.5)
    fx = M + tw('Facebook: ', 'P-Medium', 8.5)
    c.linkURL(FB_URL, (fx, y - 3, fx + tw('AIFeed.run AI News', 'P-Regular', 8.5), y + 10), relative=0)

    # CTA pill
    y -= 34
    t = 'Free weekly AI brief at aifeed.run'
    pw = tw(t, 'P-SemiBold', 9.5) + 34
    grad_rect(c, M, y - 8, pw, 24, 12)
    text(c, M + pw / 2, y, t, 'P-SemiBold', 9.5, WHITE, 'center')
    c.linkURL('https://aifeed.run', (M, y - 8, M + pw, y + 16), relative=0)
    footer(c)

c = canvas.Canvas(OUT, pagesize=letter, pageCompression=1)
c.setTitle('AIFeed.run Media Kit 2026'); c.setAuthor('AIFeed.run'); c.setCreator('AIFeed.run')
c.setSubject('AIFeed.run AI News: The AI news that matters.')
page1(c); c.showPage(); page2(c); c.showPage(); c.save()
print('wrote', OUT)
