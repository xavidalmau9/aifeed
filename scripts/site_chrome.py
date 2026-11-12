"""Shared AIFeed.run page chrome for the static site and the SEO build."""
import html
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://aifeed.run"
BEEHIIV = "https://magic.beehiiv.com/v1/eb0b9508-1ffd-4fb1-a63c-e762fa86569c"
esc = lambda s: html.escape(str(s or ""), quote=True)

CATS = {
    "models", "tools", "research", "business", "policy", "safety", "security",
    "industry", "products", "hardware", "infrastructure", "health",
}
CORE = ["Models", "Tools", "Policy", "Safety", "Business", "Research"]

IG = "https://www.instagram.com/aifeed.run/"
FB = "https://www.facebook.com/profile.php?id=61594868144059"
LI = "https://www.linkedin.com/company/aifeed-run"
SOC = (
    ("Instagram", IG, "@aifeed.run",
     '<path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>'),
    ("Facebook", FB, "Facebook",
     '<path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"/>'),
    ("LinkedIn", LI, "LinkedIn",
     '<path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>'),
)

FAVICON = (
    "<link rel=\"icon\" type=\"image/svg+xml\" href=\"data:image/svg+xml,"
    "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E"
    "%3Crect width='100' height='100' rx='18' fill='%2304020e'/%3E"
    "%3Crect width='100' height='100' rx='18' fill='none' stroke='%23a050ff' stroke-width='4' stroke-opacity='0.4'/%3E"
    "%3Ctext x='50' y='76' font-family='Arial Black,Arial,sans-serif' font-weight='900' font-size='72' fill='%23a050ff' text-anchor='middle'%3Ea%3C/text%3E"
    "%3C/svg%3E\">"
)


def svg(paths, cls="ico"):
    return f'<svg class="{cls}" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">{paths}</svg>'


def svg_stroke(inner, cls="ico"):
    return (
        f'<svg class="{cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" '
        f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{inner}</svg>'
    )


MAIL = svg_stroke('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>')
ARROW = svg_stroke('<path d="M5 12h14M13 6l6 6-6 6"/>', "ico ico-sm")
EXT = svg_stroke('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', "ico ico-sm")
LINK = svg_stroke('<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>')
CLOCK = svg_stroke('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', "ico ico-sm")
CHECK = svg_stroke('<path d="m5 12 5 5 9-10"/>', "ico ico-sm")
HOME = svg_stroke('<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>')
COMPASS = (
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" '
    'stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/>'
    '<path d="m15.5 8.5-2 5-5 2 2-5z" fill="currentColor" fill-opacity=".25"/></svg>'
)
WORD = (
    '<a class="wordmark" href="/" aria-label="AIFeed.run home">'
    '<span class="w-ai">AI</span><span class="w-feed">Feed</span><span class="w-run">.run</span></a>'
)


def topic_slug(c):
    return re.sub(r"[^a-z0-9]+", "-", str(c or "AI").lower()).strip("-") or "ai"


def cat_var(name):
    key = topic_slug(name)
    if key in CATS:
        return f"var(--cat-{key})"
    return "var(--purple-2)"


def pill(name):
    return f'<span class="pill" style="--c:{cat_var(name)}">{esc(name or "AI")}</span>'


def story_img(src, alt, eager=False, sizes="(min-width:1100px) 300px, 96px", srcset=""):
    extra = f' srcset="{esc(srcset)}"' if srcset else ""
    pri = ' fetchpriority="high"' if eager else ""
    lazy = "" if eager else ' loading="lazy" decoding="async"'
    return (
        f'<img class="thumb" src="{esc(src)}" width="720" height="900" alt="{esc(alt)}"'
        f'{extra} sizes="{esc(sizes)}"{pri}{lazy}>'
    )


def header():
    social = "".join(
        f'<a class="icon-btn" href="{url}" aria-label="AIFeed.run on {label}">{svg(path)}</a>'
        for label, url, _text, path in SOC
    )
    return f'''<header class="site-header"><div class="wrap hdr">{WORD}
<nav class="nav" aria-label="Main"><a href="/news/">Latest</a><a href="/news/topics/">Topics</a><a href="/subscribe/">Newsletter</a></nav>
<div class="hdr-right"><div class="hdr-social">{social}</div>
<a class="btn btn-primary btn-sm" href="#newsletter">{MAIL}<span>Subscribe</span></a></div></div></header>'''


def footer():
    social = "".join(
        f'<a class="icon-btn" href="{url}" aria-label="AIFeed.run on {label}">{svg(path)}</a>'
        for label, url, _text, path in SOC
    )
    return f'''<footer class="site-footer"><div class="wrap ftr">
<div class="ftr-brand">{WORD}<p class="muted">The AI news that matters, with the source on every story.</p></div>
<nav class="ftr-links" aria-label="Footer"><a href="/news/">All stories</a><a href="/news/topics/">Topics</a><a href="/subscribe/">Newsletter</a><a href="/about/">About</a><a href="/faq/">FAQ</a><a href="/privacy/">Privacy</a></nav>
<div class="ftr-social">{social}</div>
<p class="ftr-copy muted">© 2026 AIFeed.run</p></div></footer>'''


def newsletter(id_="newsletter", compact=False, campaign="site", title_tag="h2"):
    cls = "nl-card nl-compact" if compact else "nl-card"
    tag = "h1" if title_tag == "h1" else "h2"
    return f'''<section class="{cls}" id="{esc(id_)}" aria-labelledby="{esc(id_)}-t">
<div class="nl-icon">{MAIL}</div>
<p class="eyebrow">Free newsletter</p>
<{tag} id="{esc(id_)}-t" class="nl-title">The week's top AI stories, every Sunday.</{tag}>
<p class="nl-copy">One email a week with the stories that mattered and a link to the source for each one.</p>
<form class="nl-form" action="{BEEHIIV}" method="get">
<label class="sr-only" for="{esc(id_)}-e">Email address</label>
<input id="{esc(id_)}-e" type="email" name="email" placeholder="you@email.com" autocomplete="email" required>
<input type="hidden" name="utm_source" value="aifeed.run">
<input type="hidden" name="utm_medium" value="website">
<input type="hidden" name="utm_campaign" value="{esc(campaign)}">
<input type="hidden" name="redirect_to" value="https://aifeed.run/subscribe/thanks/">
<button class="btn btn-primary" type="submit">Subscribe free</button></form>
<p class="nl-fine">{CHECK} Free. Unsubscribe anytime.</p></section>'''


def follow():
    buttons = "".join(
        f'<a class="follow-btn f-{label.lower()}" href="{url}">{svg(path)}<span>{esc(text)}</span></a>'
        for label, url, text, path in SOC
    )
    return f'''<section class="follow-card" aria-labelledby="fw-t"><h2 id="fw-t" class="h-sm">Follow AIFeed.run</h2>
<p class="muted">New stories land on Instagram, Facebook and LinkedIn first.</p>
<div class="follow-row">{buttons}</div></section>'''


def _chip(label, href, on, cat=None):
    cls = "chip is-on" if on else "chip"
    current = ' aria-current="page"' if on else ""
    style = f' style="--c:{cat_var(cat)}"' if cat else ""
    dot = '<span class="dot"></span>' if cat else ""
    return f'<a class="{cls}"{style} href="{href}"{current}>{dot}{esc(label)}</a>'


def chips(active=None):
    parts = [_chip("All", "/", active == "all")]
    for name in CORE:
        parts.append(_chip(name, f"/news/topics/{topic_slug(name)}/", active == name, name))
    parts.append('<a class="chip chip-more" href="/news/topics/">All topics</a>')
    return "".join(parts)


def row(headline, href, category, when, iso, source, image):
    via = f'<p class="row-src muted">via {esc(source)}</p>' if source else ""
    return f'''<article class="row"><a class="row-img" href="{esc(href)}" tabindex="-1" aria-hidden="true">{image}</a>
<div class="row-body"><div class="meta">{pill(category)}<time datetime="{esc(iso)}">{esc(when)}</time></div>
<h3 class="row-title"><a href="{esc(href)}">{esc(headline)}</a></h3>{via}</div></article>'''


def card(headline, href, category, when, iso, summary, image):
    return f'''<article class="card"><a class="card-img" href="{esc(href)}" tabindex="-1" aria-hidden="true">{image}</a>
<div class="card-body"><div class="meta">{pill(category)}<time datetime="{esc(iso)}">{esc(when)}</time></div>
<h3 class="card-title"><a href="{esc(href)}">{esc(headline)}</a></h3>
<p class="card-sum">{esc(summary)}</p></div></article>'''


def lead(headline, href, category, when, iso, summary, image):
    return f'''<section class="lead" aria-labelledby="lead-t">
<div class="lead-head"><p class="eyebrow eb-new">Latest story</p><div class="meta">{pill(category)}<time datetime="{esc(iso)}">{esc(when)}</time></div>
<h2 id="lead-t" class="lead-title"><a href="{esc(href)}">{esc(headline)}</a></h2></div>
<a class="lead-img" href="{esc(href)}" tabindex="-1" aria-hidden="true">{image}</a>
<div class="lead-tail"><p class="lead-sum">{esc(summary)}</p>
<a class="btn btn-ghost" href="{esc(href)}">Read the story {ARROW}</a></div></section>'''


def ld_script(obj):
    raw = json.dumps(obj, ensure_ascii=False).replace("</", "<\\/")
    return f'<script type="application/ld+json">{raw}</script>'


def analytics_html():
    path = os.path.join(ROOT, "_includes", "analytics.html")
    with open(path, encoding="utf-8") as fh:
        return fh.read().strip("\n")


def document(title, description, inner, *, canonical=None, robots=None, og_type="website",
             image=None, image_w=1200, image_h=630, extra_head="", jsonld=None, body_attr=""):
    image = image or (SITE + "/og-default.png")
    bits = [
        "<!DOCTYPE html>",
        '<html lang="en">',
        "<head>",
        analytics_html(),
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        extra_head.strip() if extra_head else "",
        FAVICON,
        f"<title>{esc(title)}</title>",
        f'<meta name="description" content="{esc(description)}">',
    ]
    if robots:
        bits.append(f'<meta name="robots" content="{esc(robots)}">')
    if canonical:
        bits.append(f'<link rel="canonical" href="{esc(canonical)}">')
    bits.append(f'<link rel="alternate" type="application/rss+xml" title="AIFeed.run" href="{SITE}/feed.xml">')
    bits += [
        '<meta property="og:site_name" content="AIFeed.run AI News">',
        f'<meta property="og:type" content="{esc(og_type)}">',
        '<meta property="og:locale" content="en_US">',
        f'<meta property="og:title" content="{esc(title)}">',
        f'<meta property="og:description" content="{esc(description)}">',
    ]
    if canonical:
        bits.append(f'<meta property="og:url" content="{esc(canonical)}">')
    bits += [
        f'<meta property="og:image" content="{esc(image)}">',
        f'<meta property="og:image:width" content="{int(image_w)}">',
        f'<meta property="og:image:height" content="{int(image_h)}">',
        f'<meta property="og:image:alt" content="{esc(title)}">',
        '<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{esc(title)}">',
        f'<meta name="twitter:description" content="{esc(description)}">',
        f'<meta name="twitter:image" content="{esc(image)}">',
        '<link rel="preload" href="/assets/fonts/syne-800.woff2" as="font" type="font/woff2" crossorigin>',
        '<link rel="preload" href="/assets/fonts/inter-400.woff2" as="font" type="font/woff2" crossorigin>',
        '<link rel="stylesheet" href="/assets/tokens.css">',
        '<link rel="stylesheet" href="/assets/site.css">',
    ]
    if jsonld:
        for obj in jsonld:
            bits.append(ld_script(obj))
    bits += [
        "</head>",
        f"<body{body_attr}>",
        '<a class="skip" href="#main">Skip to content</a>',
        header(),
        inner,
        footer(),
        '<script src="/assets/site.js" defer></script>',
        "</body></html>\n",
    ]
    return "\n".join(bits)
