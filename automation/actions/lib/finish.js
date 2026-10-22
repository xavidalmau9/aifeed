// Pure decisions for finishing social on a story that is already on the site.
// Caption rules match the live autopilot: weekly brief (never "daily"), no claim of human editing.
const { buildIg, checkIg, normText, cleanUrl } = require('./captions');

const PROGRESS_PATH = '_data/finish-progress.json';
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CAPTION_BANNED = /\b(daily|hand[- ]?edited|human[- ]?edited|edited by (a )?human|our editors?|curated by (our )?(team|editors|humans?))\b/i;

const OUTLETS = {
  'arstechnica.com': 'Ars Technica',
  'wired.com': 'WIRED',
  'theverge.com': 'The Verge',
  'techcrunch.com': 'TechCrunch',
  'reuters.com': 'Reuters',
  'bloomberg.com': 'Bloomberg',
  'cnbc.com': 'CNBC',
  'nytimes.com': 'The New York Times',
  'wsj.com': 'The Wall Street Journal',
  'ft.com': 'Financial Times',
  'technologyreview.com': 'MIT Technology Review',
  'venturebeat.com': 'VentureBeat',
  'engadget.com': 'Engadget',
  'axios.com': 'Axios',
  'theguardian.com': 'The Guardian'
};

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function htmlParas(html) {
  return [...String(html || '').matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m =>
    decodeEntities(m[1].replace(/<[^>]+>/g, ' ')));
}

function outletFromUrl(url) {
  const m = String(url || '').match(/^https?:\/\/(?:www\.)?([^/]+)/i);
  if (!m) return '';
  const host = m[1].toLowerCase();
  const hit = Object.keys(OUTLETS).find(k => host === k || host.endsWith('.' + k));
  return hit ? OUTLETS[hit] : host.replace(/^www\./, '');
}

function withEmoji(text) {
  const t = normText(text);
  if (/^\p{Extended_Pictographic}/u.test(t)) return t;
  return '🚨 ' + t;
}

function wordCount(s) {
  return String(s || '').split(/\s+/).filter(Boolean).length;
}

function contentParagraphs(post) {
  const raw = htmlParas(post && post.body);
  const out = [];
  for (const p of raw) {
    const t = normText(p);
    if (!t || /^source:/i.test(t) || /^get the free/i.test(t) || /^#/.test(t)) continue;
    if (CAPTION_BANNED.test(t)) continue;
    out.push(t);
  }
  if (!out.length && post && post.summary && !CAPTION_BANNED.test(post.summary)) out.push(normText(post.summary));
  return out;
}

function dropSentence(paragraphs) {
  const idx = paragraphs.reduce((best, p, i) => wordCount(p) > wordCount(paragraphs[best]) ? i : best, 0);
  const sents = paragraphs[idx].split(/(?<=[.!?])\s+/);
  if (sents.length < 2) return null;
  sents.pop();
  const next = paragraphs.slice();
  next[idx] = sents.join(' ').trim();
  return next.every(Boolean) ? next : null;
}

function igCaptionFromPost(post) {
  if (!post || !post.sourceUrl) throw new Error('published post has no source URL');
  const tags = Array.isArray(post.hashtags) ? post.hashtags : [];
  if (tags.length < 5) throw new Error('published post needs 5 hashtags to build the IG caption');
  const paras = contentParagraphs(post);
  if (paras.length < 4) throw new Error('not enough clean paragraphs to build an IG caption');
  const hook = withEmoji(paras[0]);
  const rest = paras.slice(1);
  const outlet = outletFromUrl(post.sourceUrl);
  let lastErr = 'could not build an IG caption inside the layout rules';
  for (const n of [4, 3]) {
    if (rest.length < n) continue;
    let chosen = rest.slice(0, n);
    for (let guard = 0; guard < 80; guard++) {
      const cap = buildIg({
        igHook: hook,
        igParagraphs: chosen,
        igHashtags: tags,
        outlet
      }, post.sourceUrl);
      if (CAPTION_BANNED.test(cap)) throw new Error('refusing a caption that says daily or claims human editing');
      const errs = checkIg(cap, post.sourceUrl);
      if (!errs.length) return cap;
      lastErr = errs.join('; ');
      const wordErr = errs.length === 1 && /^IG body words (\d+)/.exec(errs[0]);
      if (!wordErr || Number(wordErr[1]) <= 230) break;
      const trimmed = dropSentence(chosen);
      if (!trimmed) break;
      chosen = trimmed;
    }
  }
  throw new Error('IG caption check failed: ' + lastErr);
}

function photoUrlFromHtml(html) {
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const attrs = {};
    for (const m of tag.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs[m[1].toLowerCase()] = decodeEntities(m[2] != null ? m[2] : m[3]);
    }
    const prop = (attrs.property || attrs.name || '').toLowerCase();
    if ((prop === 'og:image' || prop === 'og:image:url') && /^https?:\/\//i.test(attrs.content || '')) {
      return attrs.content;
    }
  }
  return '';
}

function textHasUrl(text, url) {
  const raw = String(text || '');
  const clean = cleanUrl(url);
  if (!clean || clean.length < 12 || !raw) return false;
  const forms = [clean, clean.replace(/\/$/, '')];
  return forms.some(f => f && raw.includes(f));
}

function matchingStory(progress, stories) {
  const row = progress || {};
  if (row.igStoryId) return { id: String(row.igStoryId), post: false };
  if (row.storyAttemptAt) {
    const t = Date.parse(row.storyAttemptAt);
    if (!Number.isNaN(t)) {
      const hit = (stories || []).find(s => {
        const st = Date.parse(s && s.timestamp);
        return s && s.id && !Number.isNaN(st) && st >= t - 120000;
      });
      if (hit) return { id: String(hit.id), post: false };
    }
  }
  return { id: '', post: true };
}

function planFinish({ sourceUrl, progress, igMedia, fbPosts, igStories, storiesKnown = true } = {}) {
  const row = progress || {};
  const ig = (igMedia || []).find(m => textHasUrl(m && m.caption, sourceUrl));
  const fb = (fbPosts || []).find(m => textHasUrl(m && m.message, sourceUrl) || textHasUrl(m && m.description, sourceUrl));
  const story = matchingStory(row, igStories);
  const igReelId = ig && ig.id ? String(ig.id) : (row.igReelId ? String(row.igReelId) : '');
  const fbPostId = fb && fb.id ? String(fb.id) : (row.fbPostId ? String(row.fbPostId) : '');
  let error = '';
  if (!story.id && row.storyAttemptAt && !storiesKnown) {
    error = 'Instagram stories list failed after a previous attempt; refusing to post another Story';
  }
  const postReel = !igReelId;
  const postFb = !fbPostId;
  const postStory = !error && story.post && !story.id;
  return {
    igReelId,
    igStoryId: story.id,
    fbPostId,
    postReel,
    postStory,
    postFb,
    done: !error && !postReel && !postStory && !postFb,
    error
  };
}

function pickEntry(history, claimsDoc, slug) {
  const hits = ((history && history.posted) || []).filter(p => p && p.slug === slug && p.date && p.slot);
  if (!hits.length) return null;
  const claims = (claimsDoc && claimsDoc.claims) || {};
  const claimed = hits.find(p => {
    const row = claims[`${p.date}:${Number(p.slot)}`];
    return row && String(row.status || '').toLowerCase() === 'claimed';
  });
  return claimed || hits[0];
}

function storyImageName(feedImage) {
  const name = String(feedImage || '');
  if (!/\.png$/i.test(name) || name.includes('/') || name.includes('..')) throw new Error('feed image is not a png name');
  return name.replace(/\.png$/i, '_story.png');
}

function assertPhotoFile(file, readFileSync) {
  const buf = readFileSync(file);
  const jpeg = buf.length > 8000 && buf[0] === 0xff && buf[1] === 0xd8;
  const png = buf.length > 8000 && buf[0] === 0x89 && buf[1] === 0x50;
  const webp = buf.length > 8000 && buf.slice(0, 4).toString() === 'RIFF';
  if (!jpeg && !png && !webp) throw new Error('story photo is not a real image (' + buf.length + ' bytes)');
}

module.exports = {
  PROGRESS_PATH, SLUG_RE, CAPTION_BANNED, outletFromUrl, igCaptionFromPost, photoUrlFromHtml,
  textHasUrl, planFinish, pickEntry, storyImageName, assertPhotoFile, contentParagraphs
};
