import json,re,html,datetime
P=json.load(open('posts.json')); IC=json.load(open('icons.json'))
D=json.load(open('/workspace/aifeed-pr/_posts/posts-index.json'))
import collections
counts=collections.Counter(p['category'] for p in D)
E=html.escape
def svg(lab,cls='ico'): return f'<svg class="{cls}" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">{IC[lab]}</svg>'
MAIL='<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>'
ARROW='<svg class="ico ico-sm" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
EXT='<svg class="ico ico-sm" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>'
LINK='<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>'
CLOCK='<svg class="ico ico-sm" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
CHECK='<svg class="ico ico-sm" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>'
def fdate(s): return datetime.date.fromisoformat(s).strftime('%b %-d')
def cat(c): return f'<span class="pill" style="--c:var(--cat-{c.lower()})">{E(c)}</span>'
def url(p): return f'/news/{p["slug"]}/'
def src_name(p):
    from urllib.parse import urlparse
    h=urlparse(p['src']).netloc.replace('www.','') if p.get('src') else ''
    m={'zdnet.com':'ZDNET','theverge.com':'The Verge','wired.com':'WIRED','techcrunch.com':'TechCrunch','arstechnica.com':'Ars Technica','reuters.com':'Reuters','cnbc.com':'CNBC','theguardian.com':'The Guardian','bloomberg.com':'Bloomberg','technologyreview.com':'MIT Technology Review','politico.com':'Politico','fortune.com':'Fortune','businessinsider.com':'Business Insider','theregister.com':'The Register','forbes.com':'Forbes','cnn.com':'CNN','nytimes.com':'The New York Times','engadget.com':'Engadget','axios.com':'Axios'}
    return m.get(h,h)
def img(p,cls,sizes='',eager=False):
    return f'<img class="{cls}" src="img/{p["local"].split("/")[-1]}" width="720" height="900" alt="{E(p["h"])}" {"fetchpriority=high" if eager else "loading=lazy"} decoding="async">'
WORD='<a class="wordmark" href="/" aria-label="AIFeed.run home"><span class="w-ai">AI</span><span class="w-feed">Feed</span><span class="w-run">.run</span></a>'
SOC=[('Instagram','https://instagram.com/aifeed.run','@aifeed.run'),('Facebook','https://www.facebook.com/profile.php?id=61594868144059','Facebook'),('LinkedIn','https://www.linkedin.com/company/aifeed-run','LinkedIn')]
HEADER=f'''<header class="site-header"><div class="wrap hdr">{WORD}
<nav class="nav" aria-label="Main"><a href="/news/">Latest</a><a href="/news/topics/">Topics</a><a href="/subscribe/">Newsletter</a></nav>
<div class="hdr-right"><div class="hdr-social">{"".join(f'<a class="icon-btn" href="{u}" aria-label="AIFeed.run on {l}">{svg(l)}</a>' for l,u,_ in SOC)}</div>
<a class="btn btn-primary btn-sm" href="#newsletter">{MAIL}<span>Subscribe</span></a></div></div></header>'''
def newsletter(id_='newsletter',compact=False):
    return f'''<section class="nl-card{' nl-compact' if compact else ''}" id="{id_}" aria-labelledby="{id_}-t">
<div class="nl-icon">{MAIL}</div>
<p class="eyebrow">Free newsletter</p>
<h2 id="{id_}-t" class="nl-title">The week's top AI stories, every Sunday.</h2>
<p class="nl-copy">One email a week with the stories that mattered and a link to the source for each one.</p>
<form class="nl-form" action="https://magic.beehiiv.com/v1/eb0b9508-1ffd-4fb1-a63c-e762fa86569c" method="get">
<label class="sr-only" for="{id_}-e">Email address</label>
<input id="{id_}-e" type="email" name="email" placeholder="you@email.com" autocomplete="email" required>
<button class="btn btn-primary" type="submit">Subscribe free</button></form>
<p class="nl-fine">{CHECK} Free. Unsubscribe anytime.</p></section>'''
def follow(compact=False):
    return f'''<section class="follow-card" aria-labelledby="fw-t"><h2 id="fw-t" class="h-sm">Follow AIFeed.run</h2>
<p class="muted">New stories land on Instagram, Facebook and LinkedIn first.</p>
<div class="follow-row">{"".join(f'<a class="follow-btn f-{l.lower()}" href="{u}">{svg(l)}<span>{t}</span></a>' for l,u,t in SOC)}</div></section>'''
FOOTER=f'''<footer class="site-footer"><div class="wrap ftr">
<div class="ftr-brand">{WORD}<p class="muted">The AI news that matters, with the source on every story.</p></div>
<nav class="ftr-links" aria-label="Footer"><a href="/news/">All stories</a><a href="/news/topics/">Topics</a><a href="/subscribe/">Newsletter</a><a href="/about/">About</a><a href="/faq/">FAQ</a><a href="/privacy/">Privacy</a></nav>
<div class="ftr-social">{"".join(f'<a class="icon-btn" href="{u}" aria-label="AIFeed.run on {l}">{svg(l)}</a>' for l,u,_ in SOC)}</div>
<p class="ftr-copy muted">© 2026 AIFeed.run</p></div></footer>'''
CSS=open('site.css').read()
def page(title,desc,body,canon):
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{E(title)}</title><meta name="description" content="{E(desc)}"><link rel="canonical" href="{canon}">
<link rel="stylesheet" href="tokens.css"><style>{CSS}</style></head><body>{HEADER}{body}{FOOTER}</body></html>'''
def row(p,eager=False):
    return f'''<article class="row"><a class="row-img" href="{url(p)}" tabindex="-1" aria-hidden="true">{img(p,'thumb')}</a>
<div class="row-body"><div class="meta">{cat(p['c'])}<time datetime="{p['d']}">{fdate(p['d'])}</time></div>
<h3 class="row-title"><a href="{url(p)}">{E(p['h'])}</a></h3><p class="row-src muted">via {E(src_name(p))}</p></div></article>'''
def card(p):
    return f'''<article class="card"><a class="card-img" href="{url(p)}" tabindex="-1" aria-hidden="true">{img(p,'thumb')}</a>
<div class="card-body"><div class="meta">{cat(p['c'])}<time datetime="{p['d']}">{fdate(p['d'])}</time></div>
<h3 class="card-title"><a href="{url(p)}">{E(p['h'])}</a></h3><p class="card-sum">{E(p['s'])}</p></div></article>'''
CORE=['Models','Tools','Policy','Safety','Business','Research']
chips='<a class="chip is-on" href="/" aria-current="page">All</a>'+''.join(f'<a class="chip" style="--c:var(--cat-{c.lower()})" href="/news/topics/{c.lower()}/"><span class="dot"></span>{c}</a>' for c in CORE)+'<a class="chip chip-more" href="/news/topics/">All topics</a>'
lead=P[0]
home=f'''<main id="main">
<section class="intro wrap"><h1 class="intro-h">The AI news that matters.</h1>
<p class="intro-dek">Big AI stories in plain English, with the source on every one.</p></section>
<nav class="wrap chips" aria-label="Topics">{chips}</nav>
<div class="wrap home-grid">
<section class="lead" aria-labelledby="lead-t">
<div class="lead-head"><p class="eyebrow eb-new">Latest story</p><div class="meta">{cat(lead['c'])}<time datetime="{lead['d']}">{fdate(lead['d'])}</time></div>
<h2 id="lead-t" class="lead-title"><a href="{url(lead)}">{E(lead['h'])}</a></h2></div>
<a class="lead-img" href="{url(lead)}" tabindex="-1" aria-hidden="true">{img(lead,'thumb',eager=True)}</a>
<div class="lead-tail"><p class="lead-sum">{E(lead['s'])}</p>
<a class="btn btn-ghost" href="{url(lead)}">Read the story {ARROW}</a></div></section>
<aside class="rail" aria-labelledby="rail-t"><h2 id="rail-t" class="section-h">More this week</h2>
<div class="rows">{''.join(row(p) for p in P[1:5])}</div></aside>
</div>
<div class="wrap nl-band">{newsletter()}</div>
<section class="wrap" aria-labelledby="more-t"><div class="section-head"><h2 id="more-t" class="section-h">Latest stories</h2><a class="link-more" href="/news/">See all {len(D)} {ARROW}</a></div>
<div class="cards">{''.join(card(p) for p in P[5:11])}</div></section>
<section class="wrap topics" aria-labelledby="tp-t"><h2 id="tp-t" class="section-h">Browse by topic</h2>
<div class="topic-grid">{''.join(f'<a class="topic" style="--c:var(--cat-{c.lower()})" href="/news/topics/{c.lower()}/"><span class="topic-dot"></span><span class="topic-name">{c}</span><span class="topic-n">{counts[c]} stories</span></a>' for c in CORE)}</div></section>
<div class="wrap">{follow()}</div>
</main>'''
open('../prototype/index.html','w').write(page('AIFeed.run AI News — The AI news that matters','The biggest AI stories in plain English, with the original source on every one.',home,'https://aifeed.run/'))
# ---------- article
a=D[0]; body=a['body'].replace('<p>**','<p class="lede-b">').replace('**</p>','</p>')
words=len(re.sub('<[^>]+>','',body).split()); mins=max(1,round(words/230))
kt=['The research found that many AI suppliers struggle with basic security practices, including failures to patch critical vulnerabilities, protect credentials, authenticate users and email, and address network security issues.','One critical finding involves Model Context Protocol components used to link AI applications to business systems: 48.8% of 1,732 logged security findings were rated High or Critical, including code and command injection vulnerabilities.',"As enterprises invest billions in AI — with Menlo's 2026 research estimating enterprise AI spend reached $37 billion in 2025 — the security risks compound with each integration and component added to corporate ecosystems."]
same=[p for p in P[1:] if p['c']==lead['c']][:2]
nxt=P[1]
art=f'''<main id="main" class="wrap art-grid">
<article class="art">
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">›</span><a href="/news/topics/safety/">Safety</a></nav>
<div class="meta art-meta">{cat(lead['c'])}<time datetime="{lead['d']}">Nov 11, 2026</time><span class="dotsep" aria-hidden="true">•</span><span class="rt">{CLOCK}{mins} min read</span></div>
<h1 class="art-h">{E(a['headline'])}</h1>
<p class="art-dek">{E(a['summary'])}</p>
<div class="art-by"><span class="by-mark" aria-hidden="true">AI</span><div><p class="by-name">AIFeed.run AI News</p><p class="muted by-src">Based on reporting by <a href="{a['sourceUrl']}">ZDNET {EXT}</a></p></div></div>
<div class="share" aria-label="Share this story"><span class="share-l muted">Share</span>
<a class="icon-btn" href="#" aria-label="Copy link">{LINK}</a>
<a class="icon-btn" href="https://www.linkedin.com/sharing/share-offsite/?url=https://aifeed.run/news/{a['slug']}/" aria-label="Share on LinkedIn">{svg('LinkedIn')}</a>
<a class="icon-btn" href="https://www.facebook.com/sharer/sharer.php?u=https://aifeed.run/news/{a['slug']}/" aria-label="Share on Facebook">{svg('Facebook')}</a></div>
<section class="kt" aria-labelledby="kt-t"><h2 id="kt-t" class="eyebrow">Key takeaways</h2><ul>{''.join(f'<li>{E(x)}</li>' for x in kt)}</ul></section>
<figure class="art-fig">{img(lead,'thumb',eager=True)}<figcaption class="muted">Cover from the AIFeed.run post on Instagram.</figcaption></figure>
<div class="prose">{body}</div>
<a class="source-card" href="{a['sourceUrl']}"><span class="sc-l muted">Original reporting</span><span class="sc-t">Read the full report on ZDNET</span><span class="sc-go">{EXT}</span></a>
<div class="tags">{''.join(f'<a class="tag" href="/news/topics/safety/">#{t}</a>' for t in ['CyberSecurity','EnterpriseSecurity','RiskAssessment'])}</div>
{newsletter('nl-art',compact=True)}
<a class="next" href="{url(nxt)}"><span class="next-img">{img(nxt,'thumb')}</span><span class="next-body"><span class="eyebrow">Next story {ARROW}</span><span class="next-t">{E(nxt['h'])}</span><span class="meta">{cat(nxt['c']).replace('<a ','<span ').replace('</a>','</span>')}<time>{fdate(nxt['d'])}</time></span></span></a>
</article>
<aside class="art-side" aria-label="More from AIFeed.run">
<div class="side-sticky">{newsletter('nl-side',compact=True)}{follow()}</div></aside>
</main>
<section class="wrap more-sec" aria-labelledby="ms-t"><div class="section-head"><h2 id="ms-t" class="section-h">More stories</h2><a class="link-more" href="/news/">See all {ARROW}</a></div>
<div class="cards">{''.join(card(p) for p in [p for p in P[2:] if p!=nxt][:6])}</div></section>'''
art=art.replace('href="#" aria-label="Copy link"','href="#" aria-label="Copy link"')
open('../prototype/article.html','w').write(page(a['headline']+' | AIFeed.run',a['summary'],art,f'https://aifeed.run/news/{a["slug"]}/'))
print('built',words,mins)
# ---------- 404
HOME_I='<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/></svg>'
LINKOFF='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="m15.5 8.5-2 5-5 2 2-5z" fill="currentColor" fill-opacity=".25"/></svg>'
nf=f'''<main id="main" class="wrap nf-grid">
<div class="nf-main">
<section class="nf-hero" aria-labelledby="nf-t">
<div class="nf-icon">{LINKOFF}</div>
<p class="eyebrow">Error 404</p>
<h1 id="nf-t" class="nf-h">This page isn't here.</h1>
<p class="nf-copy">The link may be old or mistyped. The story you wanted is probably one tap away below.</p>
<div class="nf-actions"><a class="btn btn-primary" href="/">{HOME_I}<span>Back to the homepage</span></a><a class="btn btn-ghost" href="/news/">Browse all {len(D)} stories {ARROW}</a></div>
</section>
<nav class="nf-topics" aria-labelledby="nf-tp"><h2 id="nf-tp" class="section-h nf-sub">Pick a topic</h2><div class="chips">{chips.replace(' is-on','').replace(' aria-current="page"','')}</div></nav>
<section aria-labelledby="nf-l"><div class="section-head"><h2 id="nf-l" class="section-h">Latest stories</h2><a class="link-more" href="/news/">See all {ARROW}</a></div>
<div class="rows">{''.join(row(p) for p in P[:6])}</div></section>
</div>
<aside class="nf-side" aria-label="Stay in the loop">{newsletter('nl-404',compact=True)}{follow()}</aside>
</main>'''
p404=page('Page not found | AIFeed.run AI News','That page is not on AIFeed.run. Browse the latest AI stories or get the free weekly newsletter.',nf,'https://aifeed.run/404.html')
p404=p404.replace('<link rel="canonical" href="https://aifeed.run/404.html">','<meta name="robots" content="noindex,follow">')
open('../prototype/404.html','w').write(p404)
print('404 built')
