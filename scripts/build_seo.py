#!/usr/bin/env python3
"""Generate static, crawlable SEO pages from _posts/posts-index.json.

Outputs news/<slug>/index.html, hub pages, the homepage latest-story block,
404.html, sitemap.xml, feed.xml and llms-full.txt. Safe to re-run.
Never edits posts-index.json. Run by .github/workflows/seo-build.yml.
"""
import datetime
import json
import os
import re
from email.utils import format_datetime
from urllib.parse import quote
from zoneinfo import ZoneInfo

from analytics_snippet import inject as inject_analytics
import site_chrome as ui

SITE = ui.SITE
ROOT = ui.ROOT
esc = ui.esc
NY = ZoneInfo("America/New_York")
DEFAULT_OG = SITE + "/og-default.png"
HOME_TITLE = "AIFeed.run AI News — The AI news that matters"
HOME_DESC = "The biggest AI stories in plain English, with the original source on every one."
HOME_H1 = "The AI news that matters."
ROW_SIZES = "(min-width:1100px) 300px, 96px"
LEAD_SIZES = "(min-width:1100px) 300px, 90vw"
ART_SIZES = "(min-width:1100px) 440px, 100vw"
REDIRECT = '<script>var m=location.pathname.match(/^\\/news\\/([a-z0-9-]+)\\/?$/);if(m)location.replace(\'/post.html?slug=\'+m[1]);</script>'

OUTLETS = {
    "theverge.com": "The Verge", "cnbc.com": "CNBC", "wired.com": "WIRED", "axios.com": "Axios", "fortune.com": "Fortune",
    "9to5google.com": "9to5Google", "9to5mac.com": "9to5Mac", "engadget.com": "Engadget", "techcrunch.com": "TechCrunch",
    "reuters.com": "Reuters", "bloomberg.com": "Bloomberg", "nytimes.com": "The New York Times", "wsj.com": "The Wall Street Journal",
    "ft.com": "Financial Times", "arstechnica.com": "Ars Technica", "venturebeat.com": "VentureBeat", "businessinsider.com": "Business Insider",
    "technologyreview.com": "MIT Technology Review", "theinformation.com": "The Information", "zdnet.com": "ZDNET", "cnn.com": "CNN",
    "bbc.com": "BBC", "bbc.co.uk": "BBC", "theguardian.com": "The Guardian", "washingtonpost.com": "The Washington Post", "forbes.com": "Forbes",
    "apnews.com": "AP News", "gizmodo.com": "Gizmodo", "mashable.com": "Mashable", "techradar.com": "TechRadar", "tomsguide.com": "Tom's Guide",
    "theregister.com": "The Register", "semafor.com": "Semafor", "politico.com": "Politico", "nbcnews.com": "NBC News", "cbsnews.com": "CBS News",
    "fastcompany.com": "Fast Company", "qz.com": "Quartz", "the-decoder.com": "The Decoder", "siliconangle.com": "SiliconANGLE",
    "marktechpost.com": "MarkTechPost", "cnet.com": "CNET", "microsoft.com": "Microsoft", "cloudflare.com": "Cloudflare", "openai.com": "OpenAI",
    "anthropic.com": "Anthropic", "blog.google": "Google", "artificialintelligence-news.com": "AI News", "tomshardware.com": "Tom's Hardware",
    "scientificamerican.com": "Scientific American", "nature.com": "Nature", "time.com": "TIME",
}
TOPIC_BLURB = {
    "Industry": "Big Tech moves, AI companies, deals, jobs and the business of artificial intelligence.",
    "Business": "How AI is changing companies, markets, money and work.",
    "Safety": "AI safety, risks, misuse, deepfakes and what can go wrong with AI systems.",
    "Research": "New AI research, studies, benchmarks and scientific breakthroughs.",
    "Policy": "AI laws, regulation, government action and court cases.",
    "Models": "New AI models from OpenAI, Google, Anthropic, Meta and others, and how they compare.",
    "Tools": "AI tools and apps you can use, and what they do.",
    "Products": "AI product launches, devices and features from the biggest tech companies.",
    "Hardware": "AI chips, Nvidia, GPUs, devices and the hardware behind AI.",
    "Infrastructure": "Data centers, compute, energy and the infrastructure powering AI.",
    "Health": "AI in medicine, healthcare and biology.",
    "Security": "AI and cybersecurity: attacks, breaches, defenses and privacy.",
}
ORG = {
    "@type": "NewsMediaOrganization", "name": "AIFeed.run AI News",
    "alternateName": ["AIFeed.run", "aifeed.run"], "url": SITE + "/",
    "logo": {"@type": "ImageObject", "url": DEFAULT_OG, "width": 1200, "height": 630},
    "sameAs": [ui.IG, ui.FB, ui.LI],
    "email": "theaifeed.run@gmail.com",
}


def strip(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()


def dt(s):
    try:
        return datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        return None


def eastern(s):
    d = dt(s)
    if not d:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=datetime.timezone.utc)
    return d.astimezone(NY)


def show_date(value, year=False):
    d = eastern(value)
    if not d:
        return ""
    return d.strftime("%b %-d, %Y") if year else d.strftime("%b %-d")


def clip(s, n=160):
    s = strip(s)
    if len(s) <= n:
        return s
    cut = s[: n - 1].rsplit(" ", 1)[0].rstrip(".,;:")
    return (cut or s[: n - 1]).rstrip() + "…"


def outlet(p):
    if p.get("sourceName"):
        return strip(p["sourceName"])
    m = re.match(r"https?://(?:www\.)?([^/]+)", p.get("sourceUrl") or "")
    if not m:
        return ""
    host = m.group(1).lower()
    for dom, name in OUTLETS.items():
        if host == dom or host.endswith("." + dom):
            return name
    return host


def topic_slug(c):
    return ui.topic_slug(c)


def md_bold(h):
    return re.sub(r"\*\*([^*<>]{1,300}?)\*\*", r"<strong>\1</strong>", h or "")


def plain(h):
    return html_unescape(strip(h)).replace("**", "").strip()


def html_unescape(s):
    import html as htmlmod
    return htmlmod.unescape(s or "")


SENT_RE = re.compile(r'(?<=[.!?])\s+(?=[A-Z0-9"\u201c])')


def takeaways(p):
    paras = [plain(a) for a in re.findall(r"<p[^>]*>(.*?)</p>", p.get("body") or "", re.S)]
    paras = [a for a in paras if a and not a.lower().startswith(("source:", "read more", "follow "))]
    if len(paras) < 4:
        return []
    seen = {plain(p.get("summary")).lower(), paras[0].lower()}
    out = []
    for a in paras[1:-1]:
        first = SENT_RE.split(a, 1)[0].strip()
        if not (30 <= len(first) <= 240) or first.lower() in seen:
            continue
        if not first.endswith((".", "!", "?")):
            first += "."
        seen.add(first.lower())
        out.append(first)
        if len(out) == 4:
            break
    return out if len(out) >= 2 else []


def image_name(img):
    m = re.match(r"^(?:https://aifeed\.run)?/?images/([^/?#]+)\.(?:png|jpe?g|webp)$", img or "", re.I)
    return m.group(1) if m else ""


def cover(p, eager, sizes):
    """Return (img html, absolute webp or ''). Falls back to imageUrl when no thumbnail exists."""
    img = p.get("imageUrl") or ""
    alt = strip(p.get("headline"))
    name = image_name(img)
    if name and os.path.exists(os.path.join(ROOT, "thumbs", name + "-720.webp")):
        src = f"/thumbs/{name}-720.webp"
        srcset = ""
        if os.path.exists(os.path.join(ROOT, "thumbs", name + "-240.webp")):
            srcset = f"/thumbs/{name}-240.webp 240w, {src} 720w"
        return ui.story_img(src, alt, eager, sizes, srcset), SITE + src
    return ui.story_img(img or DEFAULT_OG, alt, eager, sizes, ""), ""


def read_mins(p):
    words = [w for w in plain(p.get("body") or "").split(" ") if w]
    return max(1, round(len(words) / 230))


def body_html(raw):
    h = md_bold(raw or "").replace("**", "")
    return re.sub(r"<p(\s[^>]*)?>", '<p class="lede-b">', h, count=1)


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(inject_analytics(text))


def story_bits(p, eager, sizes, year=False):
    img, webp = cover(p, eager, sizes)
    when = show_date(p.get("publishedAt"), year=year)
    iso = str(p.get("publishedAt") or "")
    href = f"/news/{p['slug']}/"
    return {
        "img": img, "webp": webp, "when": when, "iso": iso, "href": href,
        "title": strip(p.get("headline")), "summary": strip(p.get("summary")),
        "cat": p.get("category") or "AI", "source": outlet(p),
    }


def home_latest(items, counts):
    if not items:
        return '<div class="wrap home-grid"><p class="muted">No stories yet.</p></div>'
    lead_b = story_bits(items[0], True, LEAD_SIZES, year=False)
    lead = ui.lead(lead_b["title"], lead_b["href"], lead_b["cat"], lead_b["when"], lead_b["iso"], lead_b["summary"], lead_b["img"])
    rails = []
    for p in items[1:5]:
        b = story_bits(p, False, ROW_SIZES)
        rails.append(ui.row(b["title"], b["href"], b["cat"], b["when"], b["iso"], b["source"], b["img"]))
    cards = []
    for p in items[5:12]:
        b = story_bits(p, False, ROW_SIZES)
        cards.append(ui.card(b["title"], b["href"], b["cat"], b["when"], b["iso"], b["summary"], b["img"]))
    topics = []
    for name in ui.CORE:
        n = counts.get(name, 0)
        topics.append(
            f'<a class="topic" style="--c:{ui.cat_var(name)}" href="/news/topics/{topic_slug(name)}/">'
            f'<span class="topic-name">{esc(name)}</span><span class="topic-n">{n} stories</span></a>'
        )
    total = len(items)
    return f'''<div class="wrap home-grid">
{lead}
<aside class="rail" aria-labelledby="rail-t"><h2 id="rail-t" class="section-h">More this week</h2>
<div class="rows">{''.join(rails)}</div></aside>
</div>
<div class="wrap nl-band">{ui.newsletter("newsletter", campaign="home")}</div>
<section class="wrap" aria-labelledby="more-t"><div class="section-head"><h2 id="more-t" class="section-h">Latest stories</h2><a class="link-more" href="/news/">See all {total} {ui.ARROW}</a></div>
<div class="cards">{''.join(cards)}</div></section>
<section class="wrap topics" aria-labelledby="tp-t"><h2 id="tp-t" class="section-h">Browse by topic</h2>
<div class="topic-grid">{''.join(topics)}</div></section>'''


def render_home(items, counts):
    block = home_latest(items, counts)
    inner = f'''<main id="main">
<section class="intro wrap"><h1 class="intro-h">{HOME_H1}</h1>
<p class="intro-dek">Big AI stories in plain English, with the source on every one.</p></section>
<nav class="wrap chips" aria-label="Topics">{ui.chips("all")}</nav>
<!--LATEST:START-->
{block}
<!--LATEST:END-->
<div class="wrap">{ui.follow()}</div>
</main>'''
    org_ld = dict(ORG)
    org_ld["@context"] = "https://schema.org"
    org_ld["description"] = HOME_DESC
    org_ld["publishingPrinciples"] = SITE + "/about/"
    ld = [
        {"@context": "https://schema.org", "@type": "WebSite", "name": "AIFeed.run AI News",
         "alternateName": ["AIFeed.run", "aifeed.run"], "url": SITE + "/", "description": HOME_DESC,
         "inLanguage": "en-US",
         "potentialAction": {"@type": "SubscribeAction", "target": SITE + "/subscribe/", "name": "Free weekly newsletter"}},
        org_ld,
    ]
    extra = '<link rel="alternate" type="text/plain" title="llms.txt" href="https://aifeed.run/llms.txt">'
    page = ui.document(
        HOME_TITLE, HOME_DESC, inner, canonical=SITE + "/", image=DEFAULT_OG,
        extra_head=extra, jsonld=ld, body_attr=' data-page="home"',
    )
    write(os.path.join(ROOT, "index.html"), page)


def render_404(items):
    rows = []
    for i, p in enumerate(items[:6]):
        b = story_bits(p, i == 0, ROW_SIZES)
        rows.append(ui.row(b["title"], b["href"], b["cat"], b["when"], b["iso"], b["source"], b["img"]))
    desc = "That page is not on AIFeed.run. Browse the latest AI stories or get the free weekly newsletter."
    inner = f'''<main id="main" class="wrap nf-grid">
<div class="nf-main">
<section class="nf-hero" aria-labelledby="nf-t">
<div class="nf-icon">{ui.COMPASS}</div>
<p class="eyebrow">Error 404</p>
<h1 id="nf-t" class="nf-h">This page isn't here.</h1>
<p class="nf-copy">The link may be old or mistyped. The story you wanted is probably one tap away below.</p>
<div class="nf-actions"><a class="btn btn-primary" href="/">{ui.HOME}<span>Back to the homepage</span></a><a class="btn btn-ghost" href="/news/">Browse all <span id="story-count">{len(items)}</span> stories {ui.ARROW}</a></div>
</section>
<nav class="nf-topics" aria-labelledby="nf-tp"><h2 id="nf-tp" class="section-h nf-sub">Pick a topic</h2><div class="chips">{ui.chips(None)}</div></nav>
<section aria-labelledby="nf-l"><div class="section-head"><h2 id="nf-l" class="section-h">Latest stories</h2><a class="link-more" href="/news/">See all {ui.ARROW}</a></div>
<div class="rows"><!--LATEST404:START-->
{''.join(rows)}
<!--LATEST404:END--></div></section>
</div>
<aside class="nf-side" aria-label="Stay with AIFeed.run">{ui.newsletter("newsletter", compact=True, campaign="404")}{ui.follow()}</aside>
</main>'''
    page = ui.document(
        "Page not found | AIFeed.run AI News", desc, inner, robots="noindex,follow",
        extra_head=REDIRECT, body_attr=' data-page="404"',
    )
    write(os.path.join(ROOT, "404.html"), page)


def render_post_shell():
    inner = f'''<main id="main" class="wrap">
<div id="story-root"><p class="page-loading">Loading story…</p></div>
<div class="sub-narrow">{ui.newsletter("newsletter", campaign="story")}</div>
</main>'''
    page = ui.document(
        "AIFeed.run AI News",
        "The AI news that matters, with the source on every story.",
        inner, robots="noindex,follow", body_attr=' data-page="post"',
    )
    write(os.path.join(ROOT, "post.html"), page)


def article_page(p, items, index):
    slug = p["slug"]
    url = f"{SITE}/news/{slug}/"
    b = story_bits(p, True, ART_SIZES, year=True)
    title = b["title"]
    desc = clip(b["summary"] or title)
    cat = b["cat"]
    tslug = topic_slug(cat)
    pub_s = b["iso"]
    png = p.get("imageUrl") or DEFAULT_OG
    images = [png]
    if b["webp"]:
        images.append(b["webp"])
    mins = read_mins(p)
    tk = takeaways(p)
    name = b["source"]
    nxt = items[index + 1] if index + 1 < len(items) else (items[index - 1] if index else None)
    if nxt and nxt.get("slug") == slug:
        nxt = None
    skip = {slug, (nxt or {}).get("slug")}
    more = [q for q in items if q.get("slug") not in skip][:6]
    src_url = p.get("sourceUrl") or ""
    by_src = ""
    if src_url:
        label = name or "the original report"
        by_src = f'<p class="muted by-src">Based on reporting by <a href="{esc(src_url)}" rel="noopener" target="_blank">{esc(label)} {ui.EXT}</a></p>'
    source_card = ""
    if src_url:
        label = f" on {esc(name)}" if name else ""
        source_card = (
            f'<a class="source-card" href="{esc(src_url)}" rel="noopener" target="_blank">'
            f'<span class="sc-l muted">Original reporting</span>'
            f'<span class="sc-t">Read the full report{label}</span><span class="sc-go">{ui.EXT}</span></a>'
        )
    tags = "".join(
        f'<a class="tag" href="/news/topics/{tslug}/">#{esc(t)}</a>'
        for t in (p.get("hashtags") or []) if t
    )
    kt_html = ""
    if tk:
        kt_html = (
            '<section class="kt" aria-labelledby="kt-t"><h2 id="kt-t" class="eyebrow">Key takeaways</h2><ul>'
            + "".join(f"<li>{esc(t)}</li>" for t in tk) + "</ul></section>"
        )
    next_html = ""
    if nxt:
        nb = story_bits(nxt, False, ROW_SIZES)
        next_html = (
            f'<a class="next" href="{esc(nb["href"])}"><span class="next-img">{nb["img"]}</span><span class="next-body">'
            f'<span class="eyebrow">Next story {ui.ARROW}</span><span class="next-t">{esc(nb["title"])}</span>'
            f'<span class="meta">{ui.pill(nb["cat"])}<time datetime="{esc(nb["iso"])}">{esc(nb["when"])}</time></span>'
            f"</span></a>"
        )
    more_cards = []
    for q in more:
        mb = story_bits(q, False, ROW_SIZES)
        more_cards.append(ui.card(mb["title"], mb["href"], mb["cat"], mb["when"], mb["iso"], mb["summary"], mb["img"]))
    share_li = "https://www.linkedin.com/sharing/share-offsite/?url=" + quote(url, safe="")
    share_fb = "https://www.facebook.com/sharer/sharer.php?u=" + quote(url, safe="")
    ig_line = (
        f'<p>Follow <a href="{ui.IG}" rel="noopener">@aifeed.run</a> on Instagram for the AI news that matters.</p>'
    )
    inner = f'''<main id="main" class="wrap art-grid">
<article class="art">
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">›</span><a href="/news/topics/{tslug}/">{esc(cat)}</a></nav>
<div class="meta art-meta">{ui.pill(cat)}<time datetime="{esc(pub_s)}">{esc(b["when"])}</time><span aria-hidden="true">•</span><span class="rt">{ui.CLOCK}{mins} min read</span></div>
<h1 class="art-h">{esc(title)}</h1>
<p class="art-dek">{esc(b["summary"])}</p>
<div class="art-by"><span class="by-mark" aria-hidden="true">AI</span><div><p class="by-name">AIFeed.run AI News</p>{by_src}</div></div>
<div class="share"><span class="share-l muted">Share</span>
<button class="icon-btn" type="button" data-copy="{esc(url)}" aria-label="Copy link">{ui.LINK}</button>
<a class="icon-btn" href="{esc(share_li)}" aria-label="Share on LinkedIn" rel="noopener" target="_blank">{ui.svg(ui.SOC[2][3])}</a>
<a class="icon-btn" href="{esc(share_fb)}" aria-label="Share on Facebook" rel="noopener" target="_blank">{ui.svg(ui.SOC[1][3])}</a></div>
{kt_html}
<figure class="art-fig">{b["img"]}<figcaption class="muted">Cover from the AIFeed.run post on Instagram.</figcaption></figure>
<div class="prose">{body_html(p.get("body") or "")}{ig_line}</div>
{source_card}
<div class="tags">{tags}</div>
{ui.newsletter("newsletter", compact=True, campaign="article")}
{next_html}
</article>
<aside class="art-side" aria-label="More from AIFeed.run"><div class="side-sticky">{ui.newsletter("newsletter-side", compact=True, campaign="article-side")}{ui.follow()}</div></aside>
</main>
<section class="wrap more-sec" aria-labelledby="ms-t"><div class="section-head"><h2 id="ms-t" class="section-h">More stories</h2><a class="link-more" href="/news/">See all {ui.ARROW}</a></div>
<div class="cards">{''.join(more_cards)}</div></section>'''
    author = {"@type": "Organization", "name": "AIFeed.run", "url": SITE + "/"}
    ld = {
        "@context": "https://schema.org", "@type": "NewsArticle", "headline": title,
        "description": desc, "image": images, "datePublished": pub_s, "dateModified": pub_s,
        "mainEntityOfPage": {"@type": "WebPage", "@id": url},
        "author": author, "publisher": ORG, "articleSection": cat,
        "keywords": ", ".join(p.get("hashtags") or []), "inLanguage": "en-US", "isAccessibleForFree": True,
    }
    if src_url:
        ld["isBasedOn"] = src_url
    crumbs = {
        "@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE + "/"},
            {"@type": "ListItem", "position": 2, "name": cat, "item": f"{SITE}/news/topics/{tslug}/"},
            {"@type": "ListItem", "position": 3, "name": title, "item": url},
        ],
    }
    extra = (
        f'<meta property="article:published_time" content="{esc(pub_s)}">'
        f'<meta property="article:section" content="{esc(cat)}">'
        f'<script>window.__AIFEED_SLUG = {json.dumps(slug)};</script>'
    )
    page = ui.document(
        f"{title} | AIFeed.run", desc, inner, canonical=url, robots="index,follow,max-image-preview:large",
        og_type="article", image=png, image_w=1080, image_h=1350, extra_head=extra,
        jsonld=[ld, crumbs], body_attr=' data-page="article"',
    )
    write(os.path.join(ROOT, "news", slug, "index.html"), page)


def hub_page(path, title, h1, intro, plist, active=None, all_topics=None):
    url = f"{SITE}/{path}"
    ld = [{
        "@context": "https://schema.org", "@type": "CollectionPage", "name": title, "description": intro, "url": url,
        "isPartOf": {"@type": "WebSite", "name": "AIFeed.run AI News", "url": SITE + "/"},
        "publisher": ORG, "inLanguage": "en-US",
        "mainEntity": {"@type": "ItemList", "numberOfItems": min(len(plist), 100), "itemListElement": [
            {"@type": "ListItem", "position": k + 1, "url": f"{SITE}/news/{q['slug']}/", "name": strip(q.get("headline"))}
            for k, q in enumerate(plist[:100])
        ]},
    }]
    crumbs = [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE + "/"},
        {"@type": "ListItem", "position": 2, "name": "All AI news", "item": SITE + "/news/"},
    ]
    if active:
        crumbs.append({"@type": "ListItem", "position": 3, "name": h1, "item": url})
    ld.append({"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": crumbs})
    cards = []
    for k, q in enumerate(plist):
        b = story_bits(q, k == 0, ROW_SIZES)
        cards.append(ui.card(b["title"], b["href"], b["cat"], b["when"], b["iso"], b["summary"], b["img"]))
    topic_grid = ""
    if all_topics:
        cells = []
        for name, n in all_topics:
            cells.append(
                f'<a class="topic" style="--c:{ui.cat_var(name)}" href="/news/topics/{topic_slug(name)}/">'
                f'<span class="topic-name">{esc(name)}</span><span class="topic-n">{n} stories</span></a>'
            )
        topic_grid = f'<section class="wrap topics" aria-labelledby="tp-t"><h2 id="tp-t" class="section-h">Topics</h2><div class="topic-grid">{"".join(cells)}</div></section>'
    chip_active = active if active else ("all" if path == "news/" else None)
    inner = f'''<main id="main">
<div class="wrap hub-intro"><h1 class="hub-h">{esc(h1)}</h1><p class="intro-dek">{esc(intro)}</p></div>
<nav class="wrap chips" aria-label="Topics">{ui.chips(chip_active)}</nav>
{topic_grid}
<section class="wrap hub-list" aria-labelledby="hub-list"><div class="section-head"><h2 id="hub-list" class="section-h">Stories</h2><a class="link-more" href="/news/">See all {ui.ARROW}</a></div>
<div class="cards">{''.join(cards)}</div></section>
</main>'''
    page = ui.document(
        title, clip(intro, 160), inner, canonical=url, robots="index,follow,max-image-preview:large",
        jsonld=ld, body_attr=' data-page="hub"',
    )
    write(os.path.join(ROOT, path, "index.html"), page)


def info(path, title, desc, inner, jsonld=None, robots=None):
    page = ui.document(title, desc, inner, canonical=SITE + "/" + path, jsonld=jsonld, robots=robots)
    write(os.path.join(ROOT, path, "index.html"), page)


def render_info():
    about = '''<main id="main"><div class="wrap static">
<h1>About AIFeed.run AI News</h1>
<p class="muted">The AI news that matters. Big AI stories in plain English, with the source on every one.</p>
<div class="card">
<p><strong>AIFeed.run AI News</strong> publishes short, source-linked AI news on <a href="https://aifeed.run/">AIFeed.run</a>, Instagram <a href="https://www.instagram.com/aifeed.run/">@aifeed.run</a>, the Facebook Page <a href="https://www.facebook.com/profile.php?id=61594868144059">AIFeed.run AI News</a>, and LinkedIn.</p>
<p>Stories cover AI models, tools, research, policy, safety and industry news from outlets such as OpenAI, Google, Anthropic, Nvidia and major tech publications. Every story points back to its source.</p>
<p>Selection and writing are automated with AI systems. We do not claim a human newsroom rewrites each story. A free weekly newsletter is available by email.</p>
</div>
<h2>Where to follow</h2>
<ul>
<li><a href="https://aifeed.run/">AIFeed.run</a> — latest stories</li>
<li><a href="https://www.instagram.com/aifeed.run/">Instagram @aifeed.run</a></li>
<li><a href="https://www.facebook.com/profile.php?id=61594868144059">Facebook — AIFeed.run AI News</a></li>
<li><a href="https://www.linkedin.com/company/aifeed-run">LinkedIn company page</a></li>
<li><a href="https://aifeed.run/subscribe/">Free weekly newsletter</a></li>
<li><a href="https://aifeed.run/feed.xml">RSS feed</a></li>
</ul>
<h2>Contact</h2>
<p>Email <a href="mailto:theaifeed.run@gmail.com">theaifeed.run@gmail.com</a> for press, sponsorships or corrections. Media kit: <a href="https://aifeed.run/AIFeed_MediaKit.pdf">AIFeed_MediaKit.pdf</a>.</p>
</div></main>'''
    about_ld = {"@context": "https://schema.org", "@type": "AboutPage", "name": "About AIFeed.run AI News",
                "url": SITE + "/about/", "description": HOME_DESC, "mainEntity": ORG}
    info("about/", "About AIFeed.run AI News", HOME_DESC, about, [about_ld])

    faq_items = [
        ("What is AIFeed.run?", "AIFeed.run AI News is an AI news brand. We publish short AI stories on AIFeed.run and social channels, with the source linked every time."),
        ("Who writes the stories?", "Stories are selected and written by AI systems from major outlets. We do not claim human editors rewrite the news."),
        ("How often do you publish?", "New stories appear on the site and social channels throughout the week. A free weekly newsletter lands by email on Sundays."),
        ("Where else can I follow?", "Instagram @aifeed.run, the Facebook Page AIFeed.run AI News, LinkedIn, and the RSS feed at aifeed.run/feed.xml. We do not use X."),
        ("Is the newsletter free?", "Yes. Subscribe at aifeed.run/subscribe. Unsubscribe in one click."),
        ("Can I advertise or sponsor?", "Yes. See the media kit at aifeed.run/AIFeed_MediaKit.pdf or email theaifeed.run@gmail.com."),
        ("How should AI tools cite you?", "Cite AIFeed.run AI News (aifeed.run), link the story URL, and prefer the original source we credit on each article."),
    ]
    faq_html = ['<main id="main"><div class="wrap static">', "<h1>FAQ</h1>", '<p class="muted">Straight answers about AIFeed.run AI News.</p>']
    for q, a in faq_items:
        faq_html.append(f'<div class="card"><h2>{esc(q)}</h2><p>{esc(a)}</p></div>')
    faq_html.append("</div></main>")
    faq_ld = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq_items
    ]}
    info("faq/", "FAQ | AIFeed.run AI News",
         "FAQ for AIFeed.run AI News: what we publish, how stories are made, the newsletter, social channels and how to cite us.",
         "\n".join(faq_html), [faq_ld])

    privacy = '''<main id="main"><div class="wrap static">
<h1>Privacy Policy</h1>
<p class="muted">Last updated: October 12, 2026</p>
<p>AIFeed.run ("we", "us") publishes AI news on <a href="https://aifeed.run/">AIFeed.run</a>, a free weekly newsletter by email, and social accounts including Instagram @aifeed.run and the Facebook Page "AIFeed.run AI News". This policy explains what data we handle and why.</p>
<h2>Website</h2>
<p>The AIFeed.run site is static. We do not run our own user accounts or store personal data on the site. Our hosting provider and any embedded services may log standard technical data such as IP address and browser type.</p>
<h2>Free weekly newsletter</h2>
<p>When you subscribe, your email address is collected and stored by our newsletter provider, Beehiiv, and used only to send the brief and related service messages. Every email includes an unsubscribe link. Beehiiv's privacy policy: <a href="https://www.beehiiv.com/privacy">beehiiv.com/privacy</a>.</p>
<h2>Instagram and Facebook messages and comments</h2>
<p>If you comment on one of our Instagram or Facebook posts or send us a direct message, we receive the data Meta provides through its official APIs, which can include:</p>
<ul>
<li>your public username or Page-scoped / Instagram-scoped user ID,</li>
<li>the text of your comment or message and its timestamp,</li>
<li>the ID of the post you commented on.</li>
</ul>
<p>We use this data only to:</p>
<ul>
<li>reply to you, including sending one automated direct message when you comment a keyword (such as "AI") asking for our newsletter link,</li>
<li>answer messages you send us,</li>
<li>prevent sending you duplicate replies.</li>
</ul>
<p>Automated replies are sent by software. We do not sell this data, use it for advertising, or share it with third parties other than the service providers that run our systems. We keep message and comment records only as long as needed for these purposes and no longer than 90 days, unless you ask us to delete them sooner. Meta's own handling of your data is covered by <a href="https://privacycenter.instagram.com/policy">Instagram's</a> and <a href="https://www.facebook.com/privacy/policy">Facebook's</a> privacy policies.</p>
<h2>Your choices and data deletion</h2>
<p>You can unsubscribe from the newsletter at any time with the link in any email. To ask us to delete data we hold about you, including Instagram or Facebook message and comment records, send a direct message to @aifeed.run on Instagram with the word "DELETE", or contact us via the Facebook Page "AIFeed.run AI News". We will confirm and delete it within 30 days.</p>
<h2>Children</h2>
<p>Our services are not directed to children under 13, and we do not knowingly collect their data.</p>
<h2>Changes</h2>
<p>We may update this policy. The date at the top shows the latest version.</p>
<p class="muted">AIFeed.run: The AI news that matters.</p>
</div></main>'''
    info("privacy/", "Privacy Policy | AIFeed.run AI News",
         "Privacy policy for AIFeed.run AI News, the weekly newsletter, and Instagram and Facebook messages.",
         privacy)

    sub = f'''<main id="main"><div class="wrap sub-narrow">
{ui.newsletter("newsletter", campaign="subscribe", title_tag="h1")}
<ul class="checks"><li>✓ One email, every Sunday</li><li>✓ Sources linked on every story</li><li>✓ Free. Unsubscribe in one click</li></ul>
<p class="muted" style="margin-top:16px">Trouble with the form? <a href="https://aifeed.beehiiv.com/subscribe" rel="noopener">Subscribe on Beehiiv</a></p>
</div></main>'''
    info("subscribe/", "Free weekly newsletter | AIFeed.run",
         "The week's top AI stories, every Sunday, with the source on every one. Free.",
         sub)
    thanks = f'''<main id="main"><div class="wrap sub-narrow">
<section class="nl-card" aria-labelledby="thanks-t">
<p class="eyebrow">Free newsletter</p>
<h1 id="thanks-t" class="nl-title">You're in.</h1>
<p class="nl-copy">Welcome to the free weekly newsletter. Your welcome email is on its way. If you don't see it in a few minutes, check Promotions or Spam and drag it to your inbox.</p>
<a class="btn btn-primary" href="/">Read the latest stories {ui.ARROW}</a>
<ul class="checks"><li>✓ One email, every Sunday</li><li>✓ Sources linked on every story</li><li>✓ Free. Unsubscribe in one click</li></ul>
</section>
<p class="muted" style="margin-top:16px"><a href="{ui.IG}">Follow @aifeed.run on Instagram</a></p>
</div></main>'''
    info("subscribe/thanks/", "You're subscribed | AIFeed.run",
         "Welcome to the free weekly newsletter from AIFeed.run.",
         thanks, robots="noindex")
    news_page = f'''<main id="main"><div class="wrap static">
<h1>Free weekly newsletter</h1>
<p class="muted">The week's top AI stories, every Sunday, with the source on every one.</p>
<div class="card"><p>The newsletter is the email version of AIFeed.run AI News. Same short stories, one inbox drop each week.</p>
<p><a href="/subscribe/">Subscribe free</a></p></div>
</div></main>'''
    info("newsletter/", "Newsletter | AIFeed.run AI News",
         "Free weekly newsletter from AIFeed.run: the week's top AI stories every Sunday, with sources.",
         news_page)


def main():
    posts = json.load(open(os.path.join(ROOT, "_posts/posts-index.json")))
    seen, items = set(), []
    for p in sorted(posts, key=lambda p: str(p.get("publishedAt") or p.get("date") or ""), reverse=True):
        s = p.get("slug")
        if not s or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,120}", s) or s in seen:
            continue
        seen.add(s)
        items.append(p)
    topics = {}
    for p in items:
        topics.setdefault(p.get("category") or "AI", []).append(p)
    topic_order = sorted(topics, key=lambda c: -len(topics[c]))
    counts = {c: len(topics[c]) for c in topics}

    for i, p in enumerate(items):
        article_page(p, items, i)

    hub_page(
        "news/", "All AI News Stories | AIFeed.run AI News", "All AI news stories",
        "Every AIFeed.run story, newest first. The AI news that matters, with the source on every one.",
        items, active=None,
    )
    hub_page(
        "news/topics/", "AI News by Topic | AIFeed.run AI News", "AI news by topic",
        "Browse AIFeed.run stories by topic: " + ", ".join(topic_order) + ".",
        items[:12], all_topics=[(c, counts[c]) for c in topic_order],
    )
    for c in topic_order:
        blurb = TOPIC_BLURB.get(c, f"The latest AI news about {c.lower()}.")
        hub_page(
            f"news/topics/{topic_slug(c)}/", f"AI {c} News | AIFeed.run AI News", f"AI {c} news",
            f"{blurb} Latest {c.lower()} stories from AIFeed.run, with the source on every one.",
            topics[c], active=c,
        )

    render_home(items, counts)
    render_404(items)
    render_post_shell()
    render_info()

    today = datetime.date.today().isoformat()
    static_pages = ["news/", "news/topics/"] + [f"news/topics/{topic_slug(c)}/" for c in topic_order] + [
        "about/", "faq/", "subscribe/", "newsletter/", "privacy/", "llms.txt", "llms-full.txt", "feed.xml",
    ]
    sm = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
        f"<url><loc>{SITE}/</loc><lastmod>{today}</lastmod><changefreq>hourly</changefreq></url>",
    ]
    for sp in static_pages:
        sm.append(f"<url><loc>{SITE}/{sp}</loc><lastmod>{today}</lastmod><changefreq>weekly</changefreq></url>")
    for p in items:
        pub = dt(p.get("publishedAt"))
        sm.append(
            f"<url><loc>{SITE}/news/{p['slug']}/</loc>"
            + (f"<lastmod>{pub.date().isoformat()}</lastmod>" if pub else "")
            + (f"<image:image><image:loc>{esc(p['imageUrl'])}</image:loc></image:image>" if p.get("imageUrl") else "")
            + "</url>"
        )
    sm.append("</urlset>")
    open(os.path.join(ROOT, "sitemap.xml"), "w").write("\n".join(sm) + "\n")

    rss = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:aifeed="https://aifeed.run/ns/1.0"><channel>',
        "<title>AIFeed.run AI News — The AI news that matters.</title>",
        f"<link>{SITE}/</link>",
        f"<description>{esc(HOME_DESC)}</description>",
        "<language>en-us</language>",
        f'<atom:link href="{SITE}/feed.xml" rel="self" type="application/rss+xml" />',
    ]
    for p in items[:50]:
        pub = dt(p.get("publishedAt"))
        u = f"{SITE}/news/{p['slug']}/"
        rss.append(
            f"<item><title>{esc(strip(p.get('headline')))}</title><link>{u}</link><guid isPermaLink=\"true\">{u}</guid>"
            + (f"<pubDate>{format_datetime(pub)}</pubDate>" if pub and pub.tzinfo else "")
            + f"<description>{esc(strip(p.get('summary')))}</description>"
            + (f"<category>{esc(p['category'])}</category>" if p.get("category") else "")
            + (f"<aifeed:sourceName>{esc(outlet(p))}</aifeed:sourceName><aifeed:sourceUrl>{esc(p['sourceUrl'])}</aifeed:sourceUrl>" if p.get("sourceUrl") else "")
            + (f"<enclosure url=\"{esc(p['imageUrl'])}\" type=\"image/png\" length=\"0\" />" if p.get("imageUrl") else "")
            + "</item>"
        )
    rss.append("</channel></rss>")
    open(os.path.join(ROOT, "feed.xml"), "w").write("\n".join(rss) + "\n")

    lines = [
        "# AIFeed.run AI News",
        "",
        "> The AI news that matters. Big AI stories in plain English, with the source on every one.",
        "",
        "AIFeed.run (display name: AIFeed.run AI News) publishes short, source-linked AI news on aifeed.run, Instagram @aifeed.run, Facebook, and LinkedIn. Stories are selected and written by AI systems. We do not claim human editors rewrite the news. A free weekly newsletter is available at https://aifeed.run/subscribe/.",
        "",
        "## Site",
        f"- Home: {SITE}/",
        f"- About: {SITE}/about/",
        f"- FAQ: {SITE}/faq/",
        f"- Subscribe: {SITE}/subscribe/",
        f"- RSS: {SITE}/feed.xml",
        f"- Sitemap: {SITE}/sitemap.xml",
        f"- All stories: {SITE}/news/",
        "",
        "## Topics",
    ] + [f"- [{c}]({SITE}/news/topics/{topic_slug(c)}/): {TOPIC_BLURB.get(c, '')}" for c in topic_order] + [
        "",
        "## Social",
        "- Instagram: https://www.instagram.com/aifeed.run/",
        "- Facebook: https://www.facebook.com/profile.php?id=61594868144059",
        "- LinkedIn: https://www.linkedin.com/company/aifeed-run",
        "",
        "## Recent stories",
    ]
    for p in items[:40]:
        lines.append(f"- [{strip(p.get('headline'))}]({SITE}/news/{p['slug']}/) — {strip(p.get('summary'))[:180]}")
    open(os.path.join(ROOT, "llms-full.txt"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print(f"built {len(items)} pages, {len(topic_order)} topic hubs, home, 404")


if __name__ == "__main__":
    main()
