// Pick a story photo that is not a near-duplicate of a recent post and not a generic
// company logo card. Tries the og:image, then images in the article, then other outlets
// already found for the same story. Recent posts are fingerprinted from history, or from
// the rendered card in images/ when a post has no stored fingerprint yet.
const fs = require('fs');
const path = require('path');
const { titleSim, hostOf } = require('./dedup');
const { analyzeBuffer, nearestPrint, PHOTO_LIMITS } = require('./visual');

const UA = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/124 Safari/537.36';
const SKIP_URL = /(?:^|[/_.-])(logo|icon|avatar|sprite|badge|emoji|pixel|tracker|favicon|placeholder|spacer|blank|gravatar|doubleclick|scorecard|adsystem|author_profile|google-analytics)(?:[/_.-]|$)|(?:\.svg)(?:$|\?)|^data:|g\/collect|\/undefined(?:$|\?)/i;
const SKIP_CONTEXT = /content-card|article-recirc|\brecirc\b|related-stor|most-popular|author[_-]|byline|\/authors\/|summary-item|newsletter|comment-list|site-footer/i;

function articlesApi() {
  return require('./articles');
}

function decodeAttr(s) {
  return String(s || '').replace(/&amp;|&#0?38;/gi, '&').replace(/&#x2F;/gi, '/').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n));
}

function attr(tag, name) {
  const m = String(tag || '').match(new RegExp('\\b' + name + '\\s*=\\s*["\']([^"\']*)["\']', 'i'));
  return m ? decodeAttr(m[1]) : '';
}

function stripQuery(url) {
  try {
    const u = new URL(url);
    return (u.host + u.pathname).toLowerCase();
  } catch (e) {
    return String(url || '').split('?')[0].toLowerCase();
  }
}

function shortUrl(url) {
  const s = String(url || '').replace(/\?.*$/, '');
  return s.length > 110 ? s.slice(0, 107) + '...' : s;
}

// Same file with the CDN crop removed. The Verge's cropped og:image and the full
// illustration are one asset; the full file is what recent rendered cards match.
function imageVariants(url) {
  try {
    const u = new URL(url);
    if (![...u.searchParams.keys()].some(k => /^(crop|rect)$/i.test(k))) return [];
    for (const k of [...u.searchParams.keys()]) {
      if (/^(crop|rect)$/i.test(k)) u.searchParams.delete(k);
    }
    const next = u.toString();
    return next && next !== url ? [next] : [];
  } catch (e) {
    return [];
  }
}

// Classes and links of elements still open at this offset. A character lookbehind
// misses Verge cards: the previous <img> is several thousand characters of srcset.
function ancestorMarks(html, index) {
  let i = index;
  const start = Math.max(0, index - 80000);
  const closes = [];
  const marks = [];
  while (i > start && marks.length < 18) {
    const lt = html.lastIndexOf('<', i - 1);
    if (lt < start) break;
    const gt = html.indexOf('>', lt);
    if (gt < 0 || gt >= index) { i = lt; continue; }
    const raw = html.slice(lt + 1, gt).trim();
    i = lt;
    if (!raw || raw.startsWith('!') || raw.startsWith('?')) continue;
    const isClose = raw.startsWith('/');
    const name = ((isClose ? raw.slice(1) : raw).match(/^([a-z0-9]+)/i) || [])[1] || '';
    if (!name) continue;
    const lower = name.toLowerCase();
    const self = /\/$/.test(raw) || /^(img|br|hr|meta|link|source|input|wbr)$/.test(lower);
    if (isClose) { closes.push(lower); continue; }
    if (self) continue;
    const at = closes.lastIndexOf(lower);
    if (at !== -1) { closes.splice(at, 1); continue; }
    const cls = (raw.match(/\bclass\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    const id = (raw.match(/\bid\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    const href = (raw.match(/\bhref\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    marks.push((lower + ' ' + cls + ' ' + id + ' ' + href).replace(/\s+/g, ' ').trim());
  }
  return marks.join(' ');
}

function fixedPixelSize(sizes) {
  const m = String(sizes || '').trim().match(/^(\d+)px$/i);
  return m ? parseInt(m[1], 10) : 0;
}

function looksLikePersonName(alt) {
  return /^[A-Z][a-z’']+(?:\s+[A-Z][a-z’']+){1,2}$/.test(String(alt || '').trim());
}

function largestFromSrcset(srcset) {
  let best = '';
  let bestW = 0;
  for (const part of String(srcset || '').split(',')) {
    const m = part.trim().match(/^(\S+)(?:\s+(\d+)w)?/i);
    if (!m) continue;
    const w = m[2] ? parseInt(m[2], 10) : 0;
    if (!best || w >= bestW) {
      best = m[1];
      bestW = w;
    }
  }
  return { url: decodeAttr(best), width: bestW };
}

function pushUnique(found, item) {
  if (!item || !item.url || !/^https:\/\//i.test(item.url)) return;
  if (SKIP_URL.test(item.url.split('?')[0])) return;
  found.push(item);
}

function jsonLdImages(html, pageUrl) {
  const { photoUrl } = articlesApi();
  const found = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    let data = null;
    try { data = JSON.parse(m[1].replace(/&amp;/g, '&')); } catch (e) { data = null; }
    if (!data) continue;
    const nodes = Array.isArray(data) ? data : [data].concat(Array.isArray(data['@graph']) ? data['@graph'] : []);
    const flat = [];
    const pushImg = v => {
      if (!v) return;
      if (typeof v === 'string') flat.push(v);
      else if (Array.isArray(v)) v.forEach(pushImg);
      else if (typeof v === 'object' && v.url) flat.push(v.url);
    };
    nodes.forEach(node => { if (node && node.image) pushImg(node.image); });
    flat.forEach(u => pushUnique(found, { url: photoUrl(u, pageUrl), score: 8000, width: 1200 }));
  }
  return found;
}

// Lead images from the article. Skips author avatars, icons, and "more stories"
// cards (another headline's photo), including when that card sits thousands of
// characters before the <img> because the previous image tag is a long srcset.
function articleImageUrls(html, pageUrl, headline) {
  const { photoUrl } = articlesApi();
  const found = jsonLdImages(html, pageUrl);
  const clean = String(html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ');
  const imgRe = /<img\b[^>]*>/gi;
  let m;
  while ((m = imgRe.exec(clean))) {
    const tag = m[0];
    const context = ancestorMarks(clean, m.index);
    if (SKIP_CONTEXT.test(context)) continue;
    const srcset = largestFromSrcset(attr(tag, 'srcset') || attr(tag, 'srcSet'));
    const rawSrc = (srcset.width >= 400 && srcset.url) ? srcset.url : (attr(tag, 'src') || attr(tag, 'data-src') || attr(tag, 'data-lazy-src') || srcset.url);
    const url = photoUrl(rawSrc, pageUrl);
    const widthAttr = parseInt(attr(tag, 'width') || '0', 10);
    const heightAttr = parseInt(attr(tag, 'height') || '0', 10);
    const width = Math.max(widthAttr || 0, srcset.width || 0);
    const shown = fixedPixelSize(attr(tag, 'sizes'));
    if ((widthAttr && heightAttr && widthAttr <= 160 && heightAttr <= 160) || (width && width < 240) || (shown > 0 && shown <= 240)) continue;
    const alt = attr(tag, 'alt');
    if (looksLikePersonName(alt) && shown > 0 && shown <= 320) continue;
    if (headline && alt.length >= 40) {
      const sim = titleSim(alt, headline);
      if (sim.jac < 0.25 && sim.shared < 3) continue;
    }
    let score = width || 400;
    if (/entry-image|article-hero|lead-image|content-header|\bfigure\b|article-body/i.test(context)) score += 5000;
    pushUnique(found, { url, score, width });
  }
  const seen = new Set();
  const out = [];
  found.sort((a, b) => b.score - a.score);
  for (const im of found) {
    const key = stripQuery(im.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: im.url, width: im.width || 0 });
    if (out.length >= 6) break;
  }
  return out;
}

function buildPhotoJudgePrompt(headline, summary) {
  const sum = String(summary || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  return `You choose the photo for one AI news graphic.
Headline: ${headline}
Story: ${sum || headline}

Reply with ONLY JSON:
{"kind":"story-photo"|"logo-card"|"unrelated","matches":true|false,"reason":"one short sentence"}

kind is logo-card when the image is mainly a company logo, wordmark, app icon, or a reusable brand illustration (a logo or wordmark on a flat, gradient, or geometric background) that a news site would reuse for any story about that company. The OpenAI knot, the Anthropic wordmark, and Google, Microsoft, Meta, or Nvidia logos count even when the background is colorful.
kind is story-photo when it shows a specific person, place, product, document, screenshot, or scene that illustrates THIS story.
kind is unrelated when it is a real photograph about a different subject.
matches is true only when a reader would recognize the image as belonging to this headline. A generic company logo does not match.`;
}

function parsePhotoVerdict(text) {
  let v = null;
  try { v = JSON.parse((String(text || '').match(/\{[\s\S]*\}/) || [''])[0]); } catch (e) { return null; }
  if (!v) return null;
  const kind = String(v.kind || '').toLowerCase().replace(/_/g, '-');
  if (!['story-photo', 'logo-card', 'unrelated'].includes(kind)) return null;
  const matches = v.matches === true || String(v.matches).toLowerCase() === 'true';
  return { kind, matches, reason: String(v.reason || '').replace(/\s+/g, ' ').trim().slice(0, 180) };
}

async function loadPhoto(url, fetchImpl) {
  const { GENERIC_PHOTO_RE } = articlesApi();
  if (!url) return { ok: false, reason: 'no image url' };
  if (!/^https:\/\//i.test(url)) return { ok: false, reason: 'image not https' };
  if (GENERIC_PHOTO_RE.test(String(url).split('?')[0])) return { ok: false, reason: 'placeholder image' };
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(20000),
      redirect: 'follow'
    });
  } catch (e) {
    return { ok: false, reason: 'image did not load' };
  }
  const type = String(res.headers.get('content-type') || '');
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok) return { ok: false, reason: 'HTTP ' + res.status };
  if (buf.length > 8 * 1024 * 1024) return { ok: false, reason: 'image over 8MB' };
  if (buf.length < 15000) return { ok: false, reason: 'too small (' + buf.length + ' bytes)' };
  if (type && !/^image\//i.test(type)) return { ok: false, reason: 'not an image (' + type + ')' };
  let analyzed;
  try { analyzed = await analyzeBuffer(buf, { fromGraphic: false, url }); }
  catch (e) { return { ok: false, reason: 'could not decode' }; }
  if (analyzed.width < 400 || analyzed.height < 220) {
    return { ok: false, reason: 'too small (' + analyzed.width + 'x' + analyzed.height + ')' };
  }
  return {
    ok: true,
    print: analyzed.print,
    generic: analyzed.generic,
    genericReason: analyzed.genericReason,
    preview: analyzed.preview,
    width: analyzed.width,
    height: analyzed.height
  };
}

function imageFile(imagesDir, image) {
  const base = path.basename(String(image || ''));
  if (!base || !/\.(png|jpe?g|webp)$/i.test(base)) return '';
  if (base === 'aifeed_endslide.png' || /_story\.png$/i.test(base)) return '';
  const file = path.join(imagesDir, base);
  return fs.existsSync(file) ? file : '';
}

async function loadRecentPrints({ history, posts, imagesDir, limit, readFile } = {}) {
  const cap = limit || PHOTO_LIMITS.recent;
  const read = readFile || (f => fs.readFileSync(f));
  const refs = [];
  const seen = new Set();
  const push = (headline, image, stored) => {
    const base = path.basename(String(image || '').split('?')[0]);
    if (!base || seen.has(base)) return;
    if (base === 'aifeed_endslide.png' || /_story\.png$/i.test(base)) return;
    if (!/\.(png|jpe?g|webp)$/i.test(base)) return;
    seen.add(base);
    refs.push({ headline: headline || '', image: base, stored: stored && stored.dhash ? stored : null });
  };
  for (const p of (history && history.posted) || []) {
    if (refs.length >= cap) break;
    push(p.headline, p.image, p.photo);
  }
  for (const p of posts || []) {
    if (refs.length >= cap) break;
    const fromUrl = String(p.imageUrl || '').split('/').pop();
    push(p.headline, p.image || fromUrl, null);
  }
  const prints = [];
  const backfill = [];
  for (const r of refs) {
    if (r.stored) {
      prints.push({
        headline: r.headline,
        image: r.image,
        dhash: r.stored.dhash,
        phash: r.stored.phash,
        hist: r.stored.hist || null,
        from: 'history'
      });
      continue;
    }
    const file = imageFile(imagesDir || '', r.image);
    if (!file) continue;
    try {
      const analyzed = await analyzeBuffer(read(file), { fromGraphic: true });
      const photo = {
        dhash: analyzed.print.dhash,
        phash: analyzed.print.phash,
        hist: analyzed.print.hist,
        via: 'backfill'
      };
      prints.push(Object.assign({ headline: r.headline, image: r.image, from: 'backfill' }, photo));
      backfill.push({ image: r.image, photo });
    } catch (e) { /* skip an unreadable file */ }
  }
  return { prints, backfill };
}

function applyPhotoBackfill(history, backfill) {
  const by = new Map((backfill || []).map(b => [b.image, b.photo]));
  const posted = (history && history.posted) || [];
  for (const p of posted) {
    const base = path.basename(String(p && p.image || ''));
    if (p && !p.photo && by.has(base)) p.photo = by.get(base);
  }
  return history;
}

async function fetchArticleImages(url, fetchImpl, headline) {
  const { meta, photoUrl } = articlesApi();
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(20000),
      redirect: 'follow'
    });
  } catch (e) {
    return null;
  }
  const html = await res.text();
  if (!html || html.length < 500) return null;
  return {
    og: photoUrl(meta(html, 'og:image') || meta(html, 'twitter:image'), url),
    inline: articleImageUrls(html, url, headline || '')
  };
}

async function refinePhotos(candidates, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const load = opts.loadImage || (url => loadPhoto(url, fetchImpl));
  const recent = opts.recent || [];
  const limits = opts.limits || PHOTO_LIMITS;
  const lines = [];
  let visionLeft = opts.visionBudget == null ? 12 : opts.visionBudget;
  const log = line => lines.push(line);

  for (const c of candidates || []) {
    if (!c || c.linkOk === false) continue;
    const title = String(c.title || '').slice(0, 70);
    const localLog = [];
    const note = line => { localLog.push(line); log(line); };
    const failures = [];
    const tried = new Set();
    let accepted = false;

    const accept = (item, loaded, because) => {
      c.ogImage = item.url;
      c.photoOk = true;
      c.photoProblem = '';
      c.photoSource = item.via;
      c.photoFingerprint = { dhash: loaded.print.dhash, phash: loaded.print.phash, hist: loaded.print.hist };
      c.photoWhy = because;
      note('  photo choose: ' + title + ' — ' + item.via + ' — ' + because + ' (' + shortUrl(item.url) + ')');
      accepted = true;
      return true;
    };

    const reject = (item, why) => {
      failures.push(why);
      note('  photo reject: ' + title + ' — ' + why + (item && item.url ? ' (' + shortUrl(item.url) + ')' : ''));
      return false;
    };

    const tryOne = async item => {
      if (!item || !item.url) return false;
      const key = stripQuery(item.url);
      if (tried.has(key)) return false;
      tried.add(key);
      let loaded;
      try { loaded = await load(item.url); }
      catch (e) { loaded = { ok: false, reason: 'did not load' }; }
      if (!loaded || !loaded.ok) return reject(item, item.via + ' rejected: ' + ((loaded && loaded.reason) || 'did not load'));
      const dup = nearestPrint(loaded.print, recent, limits);
      if (dup.near) {
        return reject(item, item.via + ' rejected: near-duplicate of "' + dup.headline + '" (dHash ' + dup.dhashDist + '/64, pHash ' + dup.phashDist + '/64, color ' + dup.hist.toFixed(2) + ')');
      }
      for (const variant of imageVariants(item.url)) {
        let extra = null;
        try { extra = await load(variant); } catch (e) { extra = null; }
        if (extra && extra.ok) {
          const again = nearestPrint(extra.print, recent, limits);
          if (again.near) {
            return reject(item, item.via + ' rejected: same artwork as "' + again.headline + '" (uncropped source dHash ' + again.dhashDist + '/64, pHash ' + again.phashDist + '/64)');
          }
        }
      }
      if (loaded.generic) return reject(item, item.via + ' rejected: generic brand/logo art — ' + loaded.genericReason);
      if (opts.judge && visionLeft > 0) {
        visionLeft -= 1;
        let verdict = null;
        try {
          verdict = await opts.judge(loaded.preview, {
            headline: c.title,
            summary: c.description || c.desc || '',
            url: item.url
          });
        } catch (e) {
          note('  photo vision failed: ' + title + ' — ' + String(e && e.message || e).slice(0, 160) + '; using the local check');
        }
        if (verdict && verdict.kind === 'logo-card') {
          return reject(item, item.via + ' rejected: vision says generic logo/brand card — ' + (verdict.reason || 'logo'));
        }
        if (verdict && (verdict.kind === 'unrelated' || verdict.matches === false)) {
          return reject(item, item.via + ' rejected: does not match the story — ' + (verdict.reason || 'unrelated'));
        }
        if (verdict && verdict.kind === 'story-photo' && verdict.matches) {
          return accept(item, loaded, 'story photo — ' + (verdict.reason || 'matches the story'));
        }
      }
      return accept(item, loaded, 'distinct photo, not a near-duplicate of recent posts');
    };

    if (c.ogImage) {
      accepted = await tryOne({ url: c.ogImage, via: 'og:image' });
    } else {
      failures.push('no og:image');
      note('  photo reject: ' + title + ' — og:image rejected: no og:image');
    }
    if (!accepted) {
      for (const im of (c.inlineImages || []).slice(0, 5)) {
        if (await tryOne({ url: im.url, via: 'in-article image' })) break;
      }
    }
    if (!accepted && (c.alts || []).length) {
      const fetchArticle = opts.fetchArticle || (url => fetchArticleImages(url, fetchImpl, c.title));
      for (const alt of c.alts.slice(0, 3)) {
        if (accepted) break;
        let page = null;
        try { page = await fetchArticle(alt.link, alt.title || c.title); }
        catch (e) { page = null; }
        if (!page) {
          note('  photo reject: ' + title + ' — other outlet ' + (alt.source || hostOf(alt.link)) + ' did not load');
          continue;
        }
        const outlet = alt.source || hostOf(alt.link);
        const altTries = [];
        if (page.og) altTries.push({ url: page.og, via: 'other outlet (' + outlet + ') og:image' });
        for (const im of (page.inline || []).slice(0, 2)) altTries.push({ url: im.url, via: 'other outlet (' + outlet + ') image' });
        for (const item of altTries) {
          if (await tryOne(item)) break;
        }
      }
    }
    if (!accepted) {
      c.photoOk = false;
      c.photoProblem = (failures[0] || 'no usable story photo').slice(0, 300);
      c.photoSource = '';
      c.photoFingerprint = null;
      c.photoWhy = '';
      note('  photo skip: ' + title + ' — no suitable photo, trying the next story (' + failures.length + ' rejected)');
    }
    c.photoLog = localLog;
  }
  return { lines };
}

module.exports = {
  articleImageUrls,
  imageVariants,
  buildPhotoJudgePrompt,
  parsePhotoVerdict,
  loadPhoto,
  loadRecentPrints,
  applyPhotoBackfill,
  fetchArticleImages,
  refinePhotos,
  stripQuery,
  shortUrl
};
