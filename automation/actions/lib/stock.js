// Wider photo search (Oct 16): press / stock photos for a story when no article image passes.
// Sources: Wikimedia Commons (keyless), Openverse (keyless), Unsplash (UNSPLASH_ACCESS_KEY), Pexels (PEXELS_API_KEY).
// Returns real image URLs only; every one still goes through the same load / duplicate / logo / vision checks.
const UA = 'AIFeedBot/1.0 (https://aifeed.run; hello@aifeed.run)';
const STOP = new Set(('a an the and or of to in on for with as at by from is are was be its it this that new now can will how why what who after over into about amid says said report reports could may might more than just your you we our their they up out off ai').split(' '));

function stockQueries(title) {
  const t = String(title || '').replace(/[’']s\b/g, '').replace(/[^\w\s.-]/g, ' ');
  const toks = t.split(/\s+/).filter(Boolean);
  // proper nouns / product names: capitalized or containing digits, not the first word unless clearly a name
  const names = [];
  toks.forEach((w, i) => {
    if (STOP.has(w.toLowerCase())) return;
    if (/^[A-Z][A-Za-z0-9.-]+$/.test(w) || /\d/.test(w) && /[A-Za-z]/.test(w)) {
      if (i === 0 && w.length < 4) return;
      names.push(w);
    }
  });
  const keywords = toks.map(w => w.toLowerCase()).filter(w => w.length > 3 && !STOP.has(w));
  const q = [];
  if (names.length) q.push(names.slice(0, 2).join(' '));
  if (names.length) q.push(names[0]);
  if (keywords.length) q.push(keywords.slice(0, 3).join(' '));
  return [...new Set(q.filter(Boolean))].slice(0, 3);
}

async function getJson(fetchImpl, url, headers = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetchImpl(url, { headers: Object.assign({ 'User-Agent': UA, Accept: 'application/json' }, headers), signal: ctl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; } finally { clearTimeout(timer); }
}

async function wikimedia(q, fetchImpl) {
  const u = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=8'
    + '&gsrsearch=' + encodeURIComponent(q + ' filetype:bitmap') + '&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=1600';
  const j = await getJson(fetchImpl, u);
  const pages = Object.values((j && j.query && j.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  return pages.map(p => (p.imageinfo || [])[0]).filter(ii => ii && /jpe?g|png|webp/.test(ii.mime || '') && (ii.width || 0) >= 800)
    .map(ii => ({ url: ii.thumburl || ii.url, via: 'Wikimedia Commons photo' }));
}

async function openverse(q, fetchImpl) {
  const j = await getJson(fetchImpl, 'https://api.openverse.org/v1/images/?page_size=8&license_type=commercial&q=' + encodeURIComponent(q));
  return ((j && j.results) || []).filter(r => r.url && (!r.width || r.width >= 800)).map(r => ({ url: r.url, via: 'Openverse photo' }));
}

async function unsplash(q, fetchImpl, key) {
  if (!key) return [];
  const j = await getJson(fetchImpl, 'https://api.unsplash.com/search/photos?per_page=6&content_filter=high&query=' + encodeURIComponent(q), { Authorization: 'Client-ID ' + key });
  return ((j && j.results) || []).map(r => ({ url: r.urls && (r.urls.regular || r.urls.full), via: 'Unsplash photo' })).filter(x => x.url);
}

async function pexels(q, fetchImpl, key) {
  if (!key) return [];
  const j = await getJson(fetchImpl, 'https://api.pexels.com/v1/search?per_page=6&query=' + encodeURIComponent(q), { Authorization: key });
  return ((j && j.photos) || []).map(p => ({ url: p.src && (p.src.large2x || p.src.large), via: 'Pexels photo' })).filter(x => x.url);
}

// Ordered list: named-entity press photos first (Wikimedia/Openverse), then stock (Unsplash/Pexels) for the topic.
async function stockCandidates(title, { fetchImpl = globalThis.fetch, keys = {}, max = 8 } = {}) {
  const out = [];
  const seen = new Set();
  const add = list => list.forEach(x => { if (x.url && !seen.has(x.url) && /^https:\/\//.test(x.url)) { seen.add(x.url); out.push(x); } });
  for (const q of stockQueries(title)) {
    if (out.length >= max) break;
    const [w, o, u, p] = await Promise.all([
      wikimedia(q, fetchImpl), openverse(q, fetchImpl), unsplash(q, fetchImpl, keys.unsplash), pexels(q, fetchImpl, keys.pexels)
    ]);
    add(w.slice(0, 2)); add(u.slice(0, 2)); add(p.slice(0, 2)); add(o.slice(0, 2));
  }
  return out.slice(0, max);
}

module.exports = { stockQueries, stockCandidates };
