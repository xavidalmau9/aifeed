// ── Shared dedupe helpers (inlined into "Fetch RSS + Dedup"; also used by tests) ──
// n8n task runners have no URL global, so parse with a regex.
function parseUrl(u) {
  const m = String(u || '').trim().match(/^(https?):\/\/([^\/?#\s]+)([^?#\s]*)(\?[^#\s]*)?/i);
  return m ? { host: m[2].toLowerCase(), path: m[3] || '', query: (m[4] || '').slice(1) } : null;
}
function hostOf(u) { const p = parseUrl(u); return p ? p.host.replace(/^www\./, '') : ''; }
// Normalized source URL: no scheme, no www./m., no tracking/any query (except real ids), no trailing slash or /amp.
function canonUrl(u) {
  const p = parseUrl(u); if (!p) return String(u || '').trim().toLowerCase();
  const keep = p.query.split('&').filter(kv => /^(id|p|v|story|article|item)=/i.test(kv)).join('&');
  const path = p.path.replace(/\/amp\/?$/i, '').replace(/\/(index\.html?)$/i, '').replace(/\/+$/, '');
  return (p.host.replace(/^(www|m|amp)\./, '') + path + (keep ? '?' + keep : '')).toLowerCase();
}
const STOP = new Set(('a an the of to in on for and or with is are was were be been by at from as its it this that these those new says said say after over into how why what who when will can could would should just now ai '
  + 'about up out off than then their they them his her he she we you your our us not no yes more most report reports reportedly amid via vs here there has have had do does did get gets got make makes made '
  + 'launch launches launched announce announces announced unveil unveils unveiled').split(/\s+/));
function tokens(t) {
  return String(t || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9$ ]/g, ' ').split(/\s+/)
    .filter(w => w.length > 1 && !STOP.has(w)).map(w => w.replace(/(ies)$/, 'y').replace(/([^s])s$/, '$1'));
}
function titleSim(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return { jac: 0, ovl: 0, shared: 0 };
  let i = 0; A.forEach(w => { if (B.has(w)) i++; });
  return { jac: i / (A.size + B.size - i), ovl: i / Math.min(A.size, B.size), shared: i };
}
// History entry: { src, title, url, canon, date }
const DAY = 86400000;
function cheapRepeat(cand, hist, opts) {
  const o = Object.assign({ jaccard: 0.6, overlap: 0.6, overlapMinShared: 3, overlapDays: 120 }, opts || {});
  const cu = canonUrl(cand.link || cand.url || '');
  for (const h of hist) {
    if (h.canon && cu && h.canon === cu) return { reason: 'same source URL', match: h };
  }
  for (const h of hist) {
    if (!h.title) continue;
    const s = titleSim(cand.title, h.title);
    if (s.jac >= o.jaccard) return { reason: 'similar title (jaccard ' + s.jac.toFixed(2) + ')', match: h };
    const recent = !h.date || (Date.now() - new Date(h.date).getTime()) < o.overlapDays * DAY;
    if (recent && s.shared >= o.overlapMinShared && s.ovl >= o.overlap) return { reason: 'similar title (overlap ' + s.ovl.toFixed(2) + ', ' + s.shared + ' shared words)', match: h };
  }
  return null;
}
const decodeEnt = s => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&#x([0-9a-f]+);/gi, (_, c) => String.fromCharCode(parseInt(c, 16))).replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c)).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/<[^>]+>/g, '').trim();
// Website posts-index.json entries -> history entries
function siteHistory(posts) {
  return (posts || []).map(p => ({ src: 'site', title: p.headline || '', summary: (p.summary || '').slice(0, 160), url: p.sourceUrl || '', canon: p.sourceUrl ? canonUrl(p.sourceUrl) : '', date: p.publishedAt || p.date || null, slug: p.slug || '' }));
}
// aifeed.run/feed.xml (fallback when posts-index cannot be read)
function feedHistory(xml) {
  return (String(xml || '').match(/<item>[\s\S]*?<\/item>/gi) || []).map(b => {
    const g = re => decodeEnt((b.match(re) || [])[1] || '');
    const src = g(/<aifeed:sourceUrl>([\s\S]*?)<\/aifeed:sourceUrl>/i);
    return { src: 'site', title: g(/<title>([\s\S]*?)<\/title>/i), summary: g(/<description>([\s\S]*?)<\/description>/i).slice(0, 160), url: src, canon: src ? canonUrl(src) : '', date: g(/<pubDate>([\s\S]*?)<\/pubDate>/i) || null };
  }).filter(h => h.title);
}
// Instagram captions -> history entries (URL from the "Source" line, title = first line / hook)
function igHistory(media) {
  return (media || []).filter(m => m && m.caption).map(m => {
    const urls = (m.caption.match(/https?:\/\/[^\s<>"')]+/g) || []).map(u => u.replace(/[.,;:!?]+$/, '')).filter(u => !/aifeed\.run/i.test(u));
    const first = m.caption.split('\n').map(l => l.replace(/^[\s\u2800]+|[\s\u2800]+$/g, '')).find(l => l && !/^source:/i.test(l)) || '';
    const hook = first.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').trim();
    const body = m.caption.replace(/\s+/g, ' ').slice(0, 220);
    return { src: 'instagram', title: hook, summary: body, url: urls[0] || '', canon: urls[0] ? canonUrl(urls[0]) : '', date: m.timestamp || null };
  });
}
function logHistory(history) {
  return ((history && history.posted) || []).map(p => ({ src: 'log', title: p.headline || '', url: p.url || '', canon: p.canonUrl || (p.url ? canonUrl(p.url) : ''), date: p.postedAt || p.date || null }));
}
