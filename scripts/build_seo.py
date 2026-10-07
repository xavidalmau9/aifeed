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
org = {"@type": "Organization", "name": "AIFeed.run", "url": SITE + "/",
       "logo": {"@type": "ImageObject", "url": SITE + "/og-image.png"},
       "sameAs": ["https://instagram.com/aifeed.run", "https://www.linkedin.com/company/aifeed-run"]}

for i, p in enumerate(items):
    slug, url = p["slug"], f"{SITE}/news/{p['slug']}/"
    title = strip(p.get("headline")); desc = strip(p.get("summary"))[:300]
    img = p.get("imageUrl") or (SITE + "/og-image.png")
    pub = dt(p.get("publishedAt")); pub_s = pub.isoformat() if pub else ""
    ld = {"@context": "https://schema.org", "@type": "NewsArticle", "headline": title[:110],
          "description": desc, "image": [img], "datePublished": pub_s, "dateModified": pub_s,
          "mainEntityOfPage": url, "author": {"@type": "Organization", "name": "AIFeed.run", "url": SITE + "/"},
          "publisher": org, "articleSection": p.get("category") or "AI",
          "keywords": ", ".join(p.get("hashtags") or [])}
    if p.get("sourceUrl"): ld["isBasedOn"] = p["sourceUrl"]
    crumbs = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "AIFeed.run", "item": SITE + "/"},
        {"@type": "ListItem", "position": 2, "name": title, "item": url}]}
    head = f"""<base href="/" />
  <title>{esc(title)} | AIFeed.run</title>
  <meta name="description" content="{esc(desc)}" />
  <link rel="canonical" href="{url}" />
  <meta name="robots" content="index,follow,max-image-preview:large" />
  <link rel="alternate" type="application/rss+xml" title="AIFeed.run" href="{SITE}/feed.xml" />
  <meta property="og:site_name" content="AIFeed.run" />
  <meta property="og:type" content="article" />
  <meta property="og:locale" content="en_US" />
  <meta property="og:title" content="{esc(title)}" />
  <meta property="og:description" content="{esc(desc)}" />
  <meta property="og:url" content="{url}" />
  <meta property="og:image" content="{esc(img)}" />
  <meta property="og:image:alt" content="{esc(title)}" />
  <meta property="article:published_time" content="{pub_s}" />
  <meta property="article:section" content="{esc(p.get('category') or 'AI')}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{esc(title)}" />
  <meta name="twitter:description" content="{esc(desc)}" />
  <meta name="twitter:image" content="{esc(img)}" />
  <script type="application/ld+json">{json.dumps(ld, ensure_ascii=False).replace('</', '<\\/')}</script>
  <script type="application/ld+json">{json.dumps(crumbs, ensure_ascii=False).replace('</', '<\\/')}</script>
  <script>window.__AIFEED_SLUG = {json.dumps(slug)};</script>"""
    page = HEAD_RE.sub(lambda m: head, tpl, count=1)
    related = [q for q in items if q is not p][:0]
    near = items[max(0, i - 3):i] + items[i + 1:i + 4]
    rel = "".join(f'<li><a href="news/{esc(q["slug"])}/">{esc(strip(q.get("headline")))}</a></li>' for q in near)
    src = f'<p>Source: <a href="{esc(p["sourceUrl"])}" rel="noopener" target="_blank">{esc(outlet(p) or "original report")}</a></p>' if p.get("sourceUrl") else ""
    static = f"""<article class="seo-static">
      <h1>{esc(title)}</h1>
      <p><time datetime="{pub_s}">{pub.strftime('%B %d, %Y') if pub else ''}</time> · {esc(p.get('category') or 'AI')}</p>
      <img src="{esc(img)}" alt="{esc(title)}" width="1080" height="1350" loading="eager" style="max-width:100%;height:auto" />
      <p><strong>{esc(desc)}</strong></p>
      {p.get('body') or ''}
      {src}
      <h2>More AI news</h2><ul>{rel}</ul>
    </article>"""
    page = page.replace('<div class="page-loading">', static + '\n    <div class="page-loading" style="display:none">', 1)
    d = os.path.join(ROOT, "news", slug); os.makedirs(d, exist_ok=True)
    open(os.path.join(d, "index.html"), "w", encoding="utf-8").write(page)

today = datetime.date.today().isoformat()
sm = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
      f"<url><loc>{SITE}/</loc><lastmod>{today}</lastmod><changefreq>hourly</changefreq></url>"]
for p in items:
    pub = dt(p.get("publishedAt"))
    sm.append(f"<url><loc>{SITE}/news/{p['slug']}/</loc>" + (f"<lastmod>{pub.date().isoformat()}</lastmod>" if pub else "")
              + (f"<image:image><image:loc>{esc(p['imageUrl'])}</image:loc></image:image>" if p.get("imageUrl") else "") + "</url>")
sm.append("</urlset>")
open(os.path.join(ROOT, "sitemap.xml"), "w").write("\n".join(sm) + "\n")

rss = ['<?xml version="1.0" encoding="UTF-8"?>', '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:aifeed="https://aifeed.run/ns/1.0"><channel>',
       "<title>AIFeed.run — Daily AI News</title>", f"<link>{SITE}/</link>",
       "<description>The top AI stories every day, zero noise.</description>", "<language>en-us</language>",
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
print(f"built {len(items)} pages")
