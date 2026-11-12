/* AIFeed.run site behavior: copy-link, and the post.html?slug= fallback.
   Static pages already contain their story. This script never removes an existing h1. */
(function () {
  var OUTLETS = {
    "theverge.com": "The Verge", "cnbc.com": "CNBC", "wired.com": "WIRED", "axios.com": "Axios",
    "fortune.com": "Fortune", "9to5google.com": "9to5Google", "9to5mac.com": "9to5Mac",
    "engadget.com": "Engadget", "techcrunch.com": "TechCrunch", "reuters.com": "Reuters",
    "bloomberg.com": "Bloomberg", "nytimes.com": "The New York Times", "wsj.com": "The Wall Street Journal",
    "ft.com": "Financial Times", "arstechnica.com": "Ars Technica", "venturebeat.com": "VentureBeat",
    "businessinsider.com": "Business Insider", "technologyreview.com": "MIT Technology Review",
    "theinformation.com": "The Information", "zdnet.com": "ZDNET", "cnn.com": "CNN", "bbc.com": "BBC",
    "bbc.co.uk": "BBC", "theguardian.com": "The Guardian", "washingtonpost.com": "The Washington Post",
    "forbes.com": "Forbes", "apnews.com": "AP News", "gizmodo.com": "Gizmodo", "mashable.com": "Mashable",
    "techradar.com": "TechRadar", "tomsguide.com": "Tom's Guide", "theregister.com": "The Register",
    "semafor.com": "Semafor", "politico.com": "Politico", "nbcnews.com": "NBC News", "cbsnews.com": "CBS News",
    "fastcompany.com": "Fast Company", "qz.com": "Quartz", "the-decoder.com": "The Decoder",
    "siliconangle.com": "SiliconANGLE", "marktechpost.com": "MarkTechPost", "cnet.com": "CNET",
    "microsoft.com": "Microsoft", "cloudflare.com": "Cloudflare", "openai.com": "OpenAI",
    "anthropic.com": "Anthropic", "blog.google": "Google", "artificialintelligence-news.com": "AI News",
    "tomshardware.com": "Tom's Hardware", "scientificamerican.com": "Scientific American",
    "nature.com": "Nature", "time.com": "TIME"
  };
  var CATS = {models:1,tools:1,research:1,business:1,policy:1,safety:1,security:1,industry:1,products:1,hardware:1,infrastructure:1,health:1};

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];
    });
  }
  function strip(s) {
    return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  function catVar(name) {
    var key = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return CATS[key] ? "var(--cat-" + key + ")" : "var(--purple-2)";
  }
  function pill(name) {
    return '<span class="pill" style="--c:' + catVar(name) + '">' + esc(name || "AI") + "</span>";
  }
  function outlet(p) {
    var m = String(p.sourceUrl || "").match(/^https?:\/\/(?:www\.)?([^/]+)/i);
    if (!m) return "";
    var host = m[1].toLowerCase();
    var keys = Object.keys(OUTLETS);
    for (var i = 0; i < keys.length; i++) {
      if (host === keys[i] || host.slice(-keys[i].length - 1) === "." + keys[i]) return OUTLETS[keys[i]];
    }
    return host;
  }
  function when(iso, withYear) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", month: "short", day: "numeric", year: withYear ? "numeric" : undefined
    }).format(d);
  }
  function topicSlug(c) {
    return String(c || "ai").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ai";
  }
  function imgName(url) {
    var m = String(url || "").match(/^(?:https:\/\/aifeed\.run)?\/?images\/([^/?#]+)\.(?:png|jpe?g|webp)$/i);
    return m ? m[1] : "";
  }
  function cover(p, eager) {
    var name = imgName(p.imageUrl);
    var src = name ? "/thumbs/" + name + "-720.webp" : (p.imageUrl || "");
    var set = name ? ' srcset="/thumbs/' + name + '-240.webp 240w, /thumbs/' + name + '-720.webp 720w"' : "";
    var lazy = eager ? ' fetchpriority="high"' : ' loading="lazy" decoding="async"';
    var fallback = p.imageUrl ? ' data-fallback="' + esc(p.imageUrl) + '"' : "";
    return '<img class="thumb" src="' + esc(src) + '"' + set + ' sizes="(min-width:1100px) 440px, 100vw" width="720" height="900" alt="' + esc(strip(p.headline)) + '"' + lazy + fallback + ">";
  }
  function bodyHtml(raw) {
    var h = String(raw || "").replace(/\*\*([^*<>]{1,300}?)\*\*/g, "<strong>$1</strong>").replace(/\*\*/g, "");
    return h.replace(/<p(\s[^>]*)?>/, '<p class="lede-b">');
  }
  function bindCopy() {
    document.querySelectorAll("[data-copy]").forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", function () {
        var url = btn.getAttribute("data-copy");
        var ok = function () { btn.setAttribute("aria-label", "Link copied"); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok, function () {});
      });
    });
  }
  function bindImages() {
    document.querySelectorAll("img[data-fallback]").forEach(function (img) {
      img.addEventListener("error", function () {
        var next = img.getAttribute("data-fallback");
        if (next && img.src.indexOf(next) === -1) {
          img.removeAttribute("srcset");
          img.src = next;
        }
      });
    });
  }

  function renderFallback(posts) {
    var params = new URLSearchParams(location.search);
    var slug = params.get("slug") || window.__AIFEED_SLUG;
    var root = document.getElementById("story-root");
    if (!root || !slug) return;
    posts.sort(function (a, b) { return String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")); });
    var idx = -1;
    for (var i = 0; i < posts.length; i++) if (posts[i].slug === slug) { idx = i; break; }
    if (idx < 0) {
      root.innerHTML = '<p class="page-loading">That story is not on AIFeed.run. <a href="/">Back to the homepage</a></p>';
      return;
    }
    var p = posts[idx];
    var nxt = posts[idx + 1] || posts[idx - 1];
    var title = strip(p.headline);
    var summary = strip(p.summary);
    var name = outlet(p);
    var words = strip(p.body).split(/\s+/).filter(Boolean).length;
    var mins = Math.max(1, Math.round(words / 230));
    var page = "https://aifeed.run/news/" + p.slug + "/";
    var cat = p.category || "AI";
    document.title = title + " | AIFeed.run";
    var src = p.sourceUrl ? '<p class="muted by-src">Based on reporting by <a href="' + esc(p.sourceUrl) + '" rel="noopener" target="_blank">' + esc(name || "the original report") + '</a></p>' : "";
    var sourceCard = p.sourceUrl ? '<a class="source-card" href="' + esc(p.sourceUrl) + '" rel="noopener" target="_blank"><span class="sc-l muted">Original reporting</span><span class="sc-t">Read the full report' + (name ? " on " + esc(name) : "") + '</span><span class="sc-go" aria-hidden="true">↗</span></a>' : "";
    var tags = (p.hashtags || []).map(function (t) {
      return '<a class="tag" href="/news/topics/' + topicSlug(cat) + '/">#' + esc(t) + "</a>";
    }).join("");
    var nextHtml = "";
    if (nxt && nxt.slug !== p.slug) {
      nextHtml = '<a class="next" href="/news/' + esc(nxt.slug) + '/"><span class="next-img">' + cover(nxt, false) + '</span><span class="next-body"><span class="eyebrow">Next story</span><span class="next-t">' + esc(strip(nxt.headline)) + '</span><span class="meta">' + pill(nxt.category) + "<time>" + esc(when(nxt.publishedAt, false)) + "</time></span></span></a>";
    }
    root.innerHTML =
      '<article class="art">' +
      '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">›</span><a href="/news/topics/' + topicSlug(cat) + '/">' + esc(cat) + "</a></nav>" +
      '<div class="meta art-meta">' + pill(cat) + '<time datetime="' + esc(p.publishedAt || "") + '">' + esc(when(p.publishedAt, true)) + '</time><span aria-hidden="true">•</span><span class="rt">' + mins + " min read</span></div>" +
      "<h1 class=\"art-h\">" + esc(title) + "</h1>" +
      '<p class="art-dek">' + esc(summary) + "</p>" +
      '<div class="art-by"><span class="by-mark" aria-hidden="true">AI</span><div><p class="by-name">AIFeed.run AI News</p>' + src + "</div></div>" +
      '<div class="share"><span class="share-l muted">Share</span>' +
      '<button class="icon-btn" type="button" data-copy="' + esc(page) + '" aria-label="Copy link">Copy</button>' +
      '<a class="icon-btn" href="https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(page) + '" aria-label="Share on LinkedIn" rel="noopener" target="_blank">in</a>' +
      '<a class="icon-btn" href="https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(page) + '" aria-label="Share on Facebook" rel="noopener" target="_blank">f</a></div>' +
      '<figure class="art-fig">' + cover(p, true) + '<figcaption class="muted">Cover from the AIFeed.run post on Instagram.</figcaption></figure>' +
      '<div class="prose">' + bodyHtml(p.body) + "</div>" +
      sourceCard +
      '<div class="tags">' + tags + "</div>" +
      nextHtml +
      "</article>";
    bindCopy();
    bindImages();
  }

  bindCopy();
  var sub = document.querySelector('.hdr-right a[href="#newsletter"]');
  var homeForm = document.getElementById("newsletter");
  if (sub && homeForm && !homeForm.offsetParent) {
    var sideForm = document.getElementById("newsletter-side");
    if (sideForm) sub.setAttribute("href", "#newsletter-side");
  }
  if (document.body.getAttribute("data-page") === "post" && !document.querySelector("article.art h1")) {
    fetch("/_posts/posts-index.json")
      .then(function (r) { return r.json(); })
      .then(renderFallback)
      .catch(function () {
        var root = document.getElementById("story-root");
        if (root) root.innerHTML = '<p class="page-loading">The story could not be loaded. <a href="/">Back to the homepage</a></p>';
      });
  }
})();
