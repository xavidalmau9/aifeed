#!/usr/bin/env python3
"""Generate static, crawlable SEO pages from _posts/posts-index.json.
Outputs: news/<slug>/index.html, sitemap.xml, feed.xml. Safe to re-run; never edits posts-index.json.
Run automatically by .github/workflows/seo-build.yml on every posts-index.json change."""
import json, html, re, os, datetime
from email.utils import format_datetime
SITE = "https://aifeed.run"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
esc = lambda s: html.escape(str(s or ""), quote=True)
def strip(s): return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()
def dt(s):
    try: return datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception: return None

OUTLETS = {"theverge.com": "The Verge", "cnbc.com": "CNBC", "wired.com": "WIRED", "axios.com": "Axios", "fortune.com": "Fortune",
    "9to5google.com": "9to5Google", "9to5mac.com": "9to5Mac", "engadget.com": "Engadget", "techcrunch.com": "TechCrunch",
    "reuters.com": "Reuters", "bloomberg.com": "Bloomberg", "nytimes.com": "The New York Times", "wsj.com": "The Wall Street Journal",
    "ft.com": "Financial Times", "arstechnica.com": "Ars Technica", "venturebeat.com": "VentureBeat", "businessinsider.com": "Business Insider",
    "technologyreview.com": "MIT Technology Review", "theinformation.com": "The Information", "zdnet.com": "ZDNET", "cnn.com": "CNN",
    "bbc.com": "BBC", "bbc.co.uk": "BBC", "theguardian.com": "The Guardian", "washingtonpost.com": "The Washington Post", "forbes.com": "Forbes",
    "apnews.com": "AP News", "gizmodo.com": "Gizmodo", "mashable.com": "Mashable", "techradar.com": "TechRadar", "tomsguide.com": "Tom's Guide",
    "theregister.com": "The Register", "semafor.com": "Semafor", "politico.com": "Politico", "nbcnews.com": "NBC News", "cbsnews.com": "CBS News",
    "fastcompany.com": "Fast Company", "qz.com": "Quartz", "the-decoder.com": "The Decoder", "siliconangle.com": "SiliconANGLE",
    "marktechpost.com": "MarkTechPost", "cnet.com": "CNET", "microsoft.com": "Microsoft", "cloudflare.com": "Cloudflare", "openai.com": "OpenAI", "anthropic.com": "Anthropic", "blog.google": "Google", "artificialintelligence-news.com": "AI News", "tomshardware.com": "Tom's Hardware", "scientificamerican.com": "Scientific American", "nature.com": "Nature", "time.com": "TIME"}
def outlet(p):
    if p.get("sourceName"): return strip(p["sourceName"])
    m = re.match(r"https?://(?:www\.)?([^/]+)", p.get("sourceUrl") or "")
    if not m: return ""
    host = m.group(1).lower()
    for dom, name in OUTLETS.items():
        if host == dom or host.endswith("." + dom): return name
    return host

posts = json.load(open(os.path.join(ROOT, "_posts/posts-index.json")))
seen, items = set(), []
for p in sorted(posts, key=lambda p: str(p.get("publishedAt") or p.get("date") or ""), reverse=True):
    s = p.get("slug")
    if not s or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,120}", s) or s in seen: continue
    seen.add(s); items.append(p)

tpl = open(os.path.join(ROOT, "post.html"), encoding="utf-8").read()
tpl = tpl.replace('<meta name="robots" content="noindex,follow" />\n', "")
tpl = tpl.replace("href=\"post.html?slug=${p.slug}\"", "href=\"news/${p.slug}/\"")
tpl = tpl.replace("const slug = params.get('slug');", "const slug = params.get('slug') || window.__AIFEED_SLUG;")
HEAD_RE = re.compile(r"<title>.*?</title>\s*<meta name=\"description\"[^>]*>", re.S)
org = {"@type": "NewsMediaOrganization", "name": "AIFeed.run AI News", "alternateName": ["AIFeed.run", "aifeed.run"], "url": SITE + "/",
       "logo": {"@type": "ImageObject", "url": SITE + "/og-default.png", "width": 1200, "height": 630},
       "sameAs": ["https://www.instagram.com/aifeed.run/", "https://www.facebook.com/profile.php?id=61594868144059", "https://www.linkedin.com/company/aifeed-run"],
       "email": "theaifeed.run@gmail.com"}
DEFAULT_OG = SITE + "/og-default.png"
SUB_URL = SITE + "/subscribe/"
IG_URL = "https://www.instagram.com/aifeed.run/"

def topic_slug(c): return re.sub(r"[^a-z0-9]+", "-", str(c or "AI").lower()).strip("-") or "ai"
def md_bold(h): return re.sub(r"\*\*([^*<>]{1,300}?)\*\*", r"<strong>\1</strong>", h or "")
def plain(h): return html.unescape(strip(h)).replace("**", "").strip()
SENT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"\u201c])")
def takeaways(p):
    """3-4 quotable one-line points: the topic sentence of each body paragraph (skips the lede, the wrap-up and source lines)."""
    paras = [plain(a) for a in re.findall(r"<p[^>]*>(.*?)</p>", p.get("body") or "", re.S)]
    paras = [a for a in paras if a and not a.lower().startswith(("source:", "read more", "follow "))]
    if len(paras) < 4: return []
    seen = {plain(p.get("summary")).lower(), paras[0].lower()}
    out = []
    for a in paras[1:-1]:
        first = SENT_RE.split(a, 1)[0].strip()
        if not (30 <= len(first) <= 240) or first.lower() in seen: continue
        if not first.endswith((".", "!", "?")): first += "."
        seen.add(first.lower()); out.append(first)
        if len(out) == 4: break
    return out if len(out) >= 2 else []
def thumb(img):
    m = re.match(r"^(?:https://aifeed\.run)?/?images/([^/?#]+)\.(?:png|jpe?g|webp)$", img or "", re.I)
    if m and os.path.exists(os.path.join(ROOT, "thumbs", m.group(1) + "-720.webp")): return f"/thumbs/{m.group(1)}-720.webp"
    return img
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

for i, p in enumerate(items):
    slug, url = p["slug"], f"{SITE}/news/{p['slug']}/"
    title = strip(p.get("headline")); desc = strip(p.get("summary"))[:300]
    img = p.get("imageUrl") or DEFAULT_OG
    pub = dt(p.get("publishedAt")); pub_s = pub.isoformat() if pub else ""
    ld = {"@context": "https://schema.org", "@type": "NewsArticle", "headline": title[:110],
          "description": desc, "image": [img], "datePublished": pub_s, "dateModified": pub_s,
          "mainEntityOfPage": url, "author": {"@type": "NewsMediaOrganization", "name": "AIFeed.run AI News", "url": SITE + "/"},
          "publisher": org, "articleSection": p.get("category") or "AI",
          "keywords": ", ".join(p.get("hashtags") or []), "inLanguage": "en-US", "isAccessibleForFree": True}
    tk = takeaways(p)
    cat = p.get("category") or "AI"; turl = f"{SITE}/news/topics/{topic_slug(cat)}/"
    if p.get("sourceUrl"): ld["isBasedOn"] = p["sourceUrl"]
    crumbs = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "AIFeed.run AI News", "item": SITE + "/"},
        {"@type": "ListItem", "position": 2, "name": f"{cat} news", "item": turl},
        {"@type": "ListItem", "position": 3, "name": title, "item": url}]}
    head = f"""<base href="/" />
  <title>{esc(title)} | AIFeed.run AI News</title>
  <meta name="description" content="{esc(desc)}" />
  <link rel="canonical" href="{url}" />
  <meta name="robots" content="index,follow,max-image-preview:large" />
  <link rel="alternate" type="application/rss+xml" title="AIFeed.run" href="{SITE}/feed.xml" />
  <meta property="og:site_name" content="AIFeed.run AI News" />
  <meta property="og:type" content="article" />
  <meta property="og:locale" content="en_US" />
  <meta property="og:title" content="{esc(title)}" />
  <meta property="og:description" content="{esc(desc)}" />
  <meta property="og:url" content="{url}" />
  <meta property="og:image" content="{esc(img)}" />
  <meta property="og:image:width" content="1080" />
  <meta property="og:image:height" content="1350" />
  <meta property="og:image:alt" content="{esc(title)}" />
  <meta property="article:published_time" content="{pub_s}" />
  <meta property="article:section" content="{esc(p.get('category') or 'AI')}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{esc(title)}" />
  <meta name="twitter:description" content="{esc(desc)}" />
  <meta name="twitter:image" content="{esc(img)}" />
  <script type="application/ld+json">{json.dumps(ld, ensure_ascii=False).replace('</', '<\\/')}</script>
  <script type="application/ld+json">{json.dumps(crumbs, ensure_ascii=False).replace('</', '<\\/')}</script>
  <script>window.__AIFEED_SLUG = {json.dumps(slug)}; window.__AIFEED_TAKEAWAYS = {json.dumps(tk, ensure_ascii=False).replace('</', '<\\/')};</script>"""
    page = HEAD_RE.sub(lambda m: head, tpl, count=1)
    same = [q for q in items if q is not p and q.get("category") == p.get("category")][:4]
    near = items[max(0, i - 3):i] + items[i + 1:i + 4]
    rel = "".join(f'<li><a href="news/{esc(q["slug"])}/">{esc(strip(q.get("headline")))}</a></li>' for q in near)
    src = f'<p>Source: <a href="{esc(p["sourceUrl"])}" rel="noopener" target="_blank">{esc(outlet(p) or "original report")}</a></p>' if p.get("sourceUrl") else ""
    tk_html = ("<section class=\"key-takeaways\" aria-label=\"Key takeaways\"><h2>Key takeaways</h2><ul>"
               + "".join(f"<li>{esc(t)}</li>" for t in tk) + "</ul></section>") if tk else ""
    rel_same = "".join(f'<li><a href="news/{esc(q["slug"])}/">{esc(strip(q.get("headline")))}</a></li>' for q in same)
    static = f"""<article class="seo-static">
      <h1>{esc(title)}</h1>
      <p><time datetime="{pub_s}">{pub.strftime('%B %d, %Y') if pub else ''}</time> · <a href="news/topics/{topic_slug(cat)}/">{esc(cat)}</a></p>
      <img src="{esc(thumb(img))}" alt="{esc(title)}" width="720" height="900" fetchpriority="high" style="max-width:100%;height:auto" />
      <p><strong>{esc(desc)}</strong></p>
      {tk_html}
      {md_bold(p.get('body') or '')}
      {src}
      <p><a href="{IG_URL}" rel="noopener">Follow @aifeed.run on Instagram</a> for AI news in 60 seconds. <a href="{SUB_URL}?utm_source=aifeed.run&amp;utm_medium=article_static">Get the free weekly AI brief</a>.</p>
      {f'<h2>More {esc(cat)} news</h2><ul>{rel_same}</ul>' if rel_same else ''}
      <h2>More AI news</h2><ul>{rel}</ul>
      <p><a href="news/">All AI news stories</a> · <a href="news/topics/">Browse by topic</a></p>
    </article>"""
    page = page.replace('<div class="page-loading">', static + '\n    <div class="page-loading" style="display:none">', 1)
    d = os.path.join(ROOT, "news", slug); os.makedirs(d, exist_ok=True)
    open(os.path.join(d, "index.html"), "w", encoding="utf-8").write(page)

# ── Hub pages: /news/ (all stories) and /news/topics/<topic>/ — crawlable, no JS needed ──
hub_tpl = tpl.replace("    loadPost();\n", "", 1)
assert hub_tpl != tpl, "post.html: loadPost() init call not found"
topics = {}
for p in items: topics.setdefault(p.get("category") or "AI", []).append(p)
topic_order = sorted(topics, key=lambda c: -len(topics[c]))
HUB_CSS = """<style>
    .hub h1 { font-family: 'Syne', sans-serif; font-size: clamp(28px, 5vw, 42px); font-weight: 800; line-height: 1.1; margin: 0 0 12px; }
    .hub .hub-intro { color: var(--muted); font-size: 16px; line-height: 1.6; margin: 0 0 22px; }
    .hub-topics { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 30px; padding: 0; list-style: none; }
    .hub-topics a { display: inline-block; padding: 6px 12px; border-radius: 50px; font-size: 12px; font-weight: 600; text-decoration: none; color: var(--white);
      border: 1px solid rgba(168,85,247,.35); background: rgba(168,85,247,.08); }
    .hub-topics a.on, .hub-topics a:hover { background: rgba(168,85,247,.3); }
    .hub-list { list-style: none; margin: 0; padding: 0; }
    .hub-list li { display: flex; gap: 14px; align-items: flex-start; padding: 14px 0; border-bottom: 1px solid rgba(168,85,247,.15); }
    .hub-list img { width: 72px; min-width: 72px; height: 90px; object-fit: cover; border-radius: 10px; background: var(--bg3); }
    .hub-list a.t { color: var(--white); font-family: 'Syne', sans-serif; font-weight: 700; font-size: 16px; line-height: 1.3; text-decoration: none; }
    .hub-list a.t:hover { color: var(--purple2); }
    .hub-list p { color: var(--muted); font-size: 13px; line-height: 1.5; margin: 4px 0 0; }
    .hub-cta { margin: 34px 0 0; padding: 20px 22px; border-radius: 16px; border: 1px solid rgba(168,85,247,.35); background: linear-gradient(135deg, rgba(124,58,237,0.14), rgba(249,115,22,0.08)); }
    .hub-cta a { color: var(--white); font-weight: 700; }
  </style>"""
def hub_page(path, title, h1, intro, plist, active=None):
    url = f"{SITE}/{path}"
    ld = [{"@context": "https://schema.org", "@type": "CollectionPage", "name": title, "description": intro, "url": url,
           "isPartOf": {"@type": "WebSite", "name": "AIFeed.run AI News", "url": SITE + "/"}, "publisher": org, "inLanguage": "en-US",
           "mainEntity": {"@type": "ItemList", "numberOfItems": min(len(plist), 100), "itemListElement": [
               {"@type": "ListItem", "position": k + 1, "url": f"{SITE}/news/{q['slug']}/", "name": strip(q.get("headline"))} for k, q in enumerate(plist[:100])]}}]
    crumbs = [{"@type": "ListItem", "position": 1, "name": "AIFeed.run AI News", "item": SITE + "/"},
              {"@type": "ListItem", "position": 2, "name": "All AI news", "item": SITE + "/news/"}]
    if active: crumbs.append({"@type": "ListItem", "position": 3, "name": h1, "item": url})
    ld.append({"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": crumbs})
    head = f"""<base href="/" />
  <title>{esc(title)}</title>
  <meta name="description" content="{esc(intro)}" />
  <link rel="canonical" href="{url}" />
  <meta name="robots" content="index,follow,max-image-preview:large" />
  <link rel="alternate" type="application/rss+xml" title="AIFeed.run" href="{SITE}/feed.xml" />
  <meta property="og:site_name" content="AIFeed.run AI News" />
  <meta property="og:type" content="website" />
  <meta property="og:locale" content="en_US" />
  <meta property="og:title" content="{esc(title)}" />
  <meta property="og:description" content="{esc(intro)}" />
  <meta property="og:url" content="{url}" />
  <meta property="og:image" content="{DEFAULT_OG}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{esc(title)}" />
  <meta name="twitter:description" content="{esc(intro)}" />
  <meta name="twitter:image" content="{DEFAULT_OG}" />
  <script type="application/ld+json">{json.dumps(ld, ensure_ascii=False).replace('</', '<\\/')}</script>
  {HUB_CSS}"""
    chips = "".join(f'<li><a href="news/topics/{topic_slug(c)}/"{" class=on" if c == active else ""}>{esc(c)} ({len(topics[c])})</a></li>' for c in topic_order)
    rows = []
    for k, q in enumerate(plist):
        qd = dt(q.get("publishedAt")); im = thumb(q.get("imageUrl") or "")
        if im and im.startswith("/thumbs/"): im = im.replace("-720.webp", "-240.webp")
        img_tag = f'<img src="{esc(im)}" alt="" width="72" height="90" loading="{"eager" if k < 4 else "lazy"}" decoding="async" />' if im else ""
        rows.append(f'<li>{img_tag}<div><a class="t" href="news/{esc(q["slug"])}/">{esc(strip(q.get("headline")))}</a>'
                    f'<p>{esc(strip(q.get("summary"))[:200])}</p><p>{qd.strftime("%b %d, %Y") if qd else ""} · {esc(q.get("category") or "AI")}</p></div></li>')
    body = f"""<div class="hub">
      <a href="/" class="back-link">← Home</a>
      <h1>{esc(h1)}</h1>
      <p class="hub-intro">{esc(intro)}</p>
      <ul class="hub-topics"><li><a href="news/"{" class=on" if not active else ""}>All ({len(items)})</a></li>{chips}</ul>
      <ul class="hub-list">{"".join(rows)}</ul>
      <div class="hub-cta">📬 <a href="{SUB_URL}?utm_source=aifeed.run&amp;utm_medium=hub">Get the free weekly AI brief</a>: the week's top AI stories, every Sunday. 📸 <a href="{IG_URL}" rel="noopener">Follow @aifeed.run on Instagram</a>.</div>
    </div>"""
    page = HEAD_RE.sub(lambda m: head, hub_tpl, count=1)
    page = re.sub(r'<div class="page-loading">.*?</div>\s*</div>', lambda m: body + "\n  </div>", page, count=1, flags=re.S)
    d = os.path.join(ROOT, path); os.makedirs(d, exist_ok=True)
    open(os.path.join(d, "index.html"), "w", encoding="utf-8").write(page)

hub_page("news/", "All AI News Stories | AIFeed.run AI News", "All AI news stories",
         "Every AIFeed.run story, newest first: the AI news that matters from OpenAI, Google, Anthropic, Nvidia and more, explained in 60 seconds with the source linked.", items)
os.makedirs(os.path.join(ROOT, "news/topics"), exist_ok=True)
# /news/topics/ index lists every topic hub
hub_page("news/topics/", "AI News by Topic | AIFeed.run AI News", "AI news by topic",
         "Browse AIFeed.run AI news by topic: " + ", ".join(topic_order) + ".", items[:30])
for c in topic_order:
    blurb = TOPIC_BLURB.get(c, f"The latest AI news about {c.lower()}.")
    hub_page(f"news/topics/{topic_slug(c)}/", f"AI {c} News | AIFeed.run AI News", f"AI {c} news",
             f"{blurb} Latest {c.lower()} stories from AIFeed.run, explained in 60 seconds with sources linked.", topics[c], active=c)

today = datetime.date.today().isoformat()
static_pages = ["news/", "news/topics/"] + [f"news/topics/{topic_slug(c)}/" for c in topic_order] + ["about/", "faq/", "subscribe/", "newsletter/", "privacy/", "llms.txt", "llms-full.txt", "feed.xml"]
sm = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
      f"<url><loc>{SITE}/</loc><lastmod>{today}</lastmod><changefreq>hourly</changefreq></url>"]
for sp in static_pages:
    sm.append(f"<url><loc>{SITE}/{sp}</loc><lastmod>{today}</lastmod><changefreq>weekly</changefreq></url>")
for p in items:
    pub = dt(p.get("publishedAt"))
    sm.append(f"<url><loc>{SITE}/news/{p['slug']}/</loc>" + (f"<lastmod>{pub.date().isoformat()}</lastmod>" if pub else "")
              + (f"<image:image><image:loc>{esc(p['imageUrl'])}</image:loc></image:image>" if p.get("imageUrl") else "") + "</url>")
sm.append("</urlset>")
open(os.path.join(ROOT, "sitemap.xml"), "w").write("\n".join(sm) + "\n")

rss = ['<?xml version="1.0" encoding="UTF-8"?>', '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:aifeed="https://aifeed.run/ns/1.0"><channel>',
       "<title>AIFeed.run AI News — The AI news that matters.</title>", f"<link>{SITE}/</link>",
       "<description>The AI news that matters. Top AI stories, explained in 60 seconds.</description>", "<language>en-us</language>",
       f'<atom:link href="{SITE}/feed.xml" rel="self" type="application/rss+xml" />']
for p in items[:50]:
    pub = dt(p.get("publishedAt")); u = f"{SITE}/news/{p['slug']}/"
    rss.append(f"<item><title>{esc(strip(p.get('headline')))}</title><link>{u}</link><guid isPermaLink=\"true\">{u}</guid>"
               + (f"<pubDate>{format_datetime(pub)}</pubDate>" if pub and pub.tzinfo else "")
               + f"<description>{esc(strip(p.get('summary')))}</description>"
               + (f"<category>{esc(p['category'])}</category>" if p.get("category") else "")
               + (f"<aifeed:sourceName>{esc(outlet(p))}</aifeed:sourceName><aifeed:sourceUrl>{esc(p['sourceUrl'])}</aifeed:sourceUrl>" if p.get("sourceUrl") else "")
               + (f"<enclosure url=\"{esc(p['imageUrl'])}\" type=\"image/png\" length=\"0\" />" if p.get("imageUrl") else "") + "</item>")
rss.append("</channel></rss>")
open(os.path.join(ROOT, "feed.xml"), "w").write("\n".join(rss) + "\n")
# llms-full.txt: citeable summary + recent headlines for AI crawlers
lines = [
    "# AIFeed.run AI News",
    "",
    "> The AI news that matters. Top AI stories from OpenAI, Google, Anthropic, Nvidia and more, explained in 60 seconds.",
    "",
    "AIFeed.run (display name: AIFeed.run AI News) publishes short, source-linked AI news on aifeed.run, Instagram @aifeed.run, Facebook, and LinkedIn. Stories are selected and written by AI systems. We do not claim human editors rewrite the news. A free weekly AI brief is available at https://aifeed.run/subscribe/.",
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
    title = strip(p.get("headline"))
    lines.append(f"- [{title}]({SITE}/news/{p['slug']}/) — {strip(p.get('summary'))[:180]}")
open(os.path.join(ROOT, "llms-full.txt"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
print(f"built {len(items)} pages, {len(topic_order)} topic hubs + llms-full.txt")
