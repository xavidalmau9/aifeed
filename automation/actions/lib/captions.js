// ── Deterministic caption builder + layout validator (shared by QC, Layout Check and Merge LI nodes) ──
const SPACER = '⠀'; // U+2800 invisible line used by Instagram to keep blank lines
function normText(s) {
  return String(s || '')
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'").replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '—').replace(/\s*—\s*/g, ' — ').replace(/\u2026/g, '...')
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000\u2800]/g, ' ')
    .replace(/https?:\/\/\S+/g, '').replace(/(^|\s)#\w+/g, '$1')
    .replace(/\s*\n+\s*/g, ' ').replace(/ {2,}/g, ' ').replace(/\s+([,.!?;:])/g, '$1').trim();
}
function normTag(t) { return String(t || '').replace(/^#+/, '').replace(/[^A-Za-z0-9]/g, ''); }
function tags5(arr) { const out = []; for (const t of (arr || []).map(normTag)) if (t && !out.some(o => o.toLowerCase() === t.toLowerCase())) out.push(t); return out.slice(0, 5); }
function cleanUrl(u) { return String(u || '').trim().replace(/[?#].*$/, m => /utm_|fbclid|gclid/.test(m) ? '' : m); }
// Closing question (Nov 2026): the caption ends with one short, easy-to-answer question tied to the story instead of
// the newsletter CTA, because comments are what push a post to more people. The model writes igQuestion; a missing or
// invalid one falls back to a safe question for the story's category. Old captions with the CTA still pass checkIg.
const Q_PREFIX = '💬 ';
const QUESTION_FALLBACK = {
  SAFETY: 'Would you trust this?', POLICY: 'Ban it or regulate it?', BUSINESS: 'Smart move or hype?',
  MODELS: 'Would you use this?', TOOLS: 'Would you use this?', RESEARCH: 'Useful or overhyped?',
  HARDWARE: 'Who wins this race?'
};
const QUESTION_BANNED = /\b(daily|follow|subscribe|link|bio|dm|hand[- ]?edited|human[- ]?edited|our editors?)\b|https?:|[#@]/i;
function validQuestion(q) {
  const t = String(q || '');
  const w = t.split(/\s+/).filter(Boolean).length;
  return w >= 2 && w <= 10 && t.length <= 70 && /\?$/.test(t) && (t.match(/\?/g) || []).length === 1 && !/[\n.!]/.test(t) && !QUESTION_BANNED.test(t);
}
function closingQuestion(g) {
  const q = normText(g && g.igQuestion).replace(/^[^A-Za-z0-9"']+/, '').trim();
  if (validQuestion(q)) return q.charAt(0).toUpperCase() + q.slice(1);
  return QUESTION_FALLBACK[String((g && g.category) || '').toUpperCase()] || 'Would you trust this?';
}
function isCloser(b) { return b === IG_CTA || (String(b || '').startsWith(Q_PREFIX) && validQuestion(String(b).slice(Q_PREFIX.length))); }
function buildIg(g, url) {
  const hook = normText(g.igHook), paras = (g.igParagraphs || []).map(normText).filter(Boolean).slice(0, 4), tg = tags5(g.igHashtags);
  const blocks = [hook, ...paras, `Source: ${normText(g.outlet)} · ${cleanUrl(url)}`, Q_PREFIX + closingQuestion(g), tg.map(t => '#' + t).join(' ')];
  return blocks.join(`\n${SPACER}\n`);
}
// Facebook Page post: the Instagram caption with the same blocks and spacers. Only the CTA changes,
// because Facebook has no "link in bio". Still exactly one URL (the source) and one Source line.
const IG_CTA = '📩 Free weekly AI brief at aifeed.run → link in bio';
const FB_CTA = '📩 Free weekly AI brief at aifeed.run/subscribe';
function buildFb(igCaption) {
  return String(igCaption || '').split(`\n${SPACER}\n`).map(b => (b === IG_CTA ? FB_CTA : b)).join(`\n${SPACER}\n`);
}
function checkFb(c, url) {
  const s = String(c || '');
  const e = [];
  const closer = s.split(`\n${SPACER}\n`).slice(-2, -1)[0] || '';
  if (closer !== FB_CTA && !isCloser(closer)) e.push('FB closing line missing (question or CTA)');
  if (/link in bio/i.test(s)) e.push('FB caption still says "link in bio"');
  if ((s.match(/^Source: /gm) || []).length !== 1) e.push('Source line must appear exactly once');
  return e.concat(checkIg(s.split(`\n${SPACER}\n`).map(b => (b === FB_CTA ? IG_CTA : b)).join(`\n${SPACER}\n`), url));
}
function buildLi(g, url) {
  const paras = [normText(g.liHook), ...(g.liParagraphs || []).map(normText).filter(Boolean), normText(g.liTakeaway)].filter(Boolean);
  const tg = tags5(g.liHashtags);
  return [...paras, `Source: ${normText(g.outlet)} · ${cleanUrl(url)}\nGet the free weekly AI brief at aifeed.run`, tg.map(t => '#' + t).join(' ')].join('\n\n');
}
function checkIg(c, url) {
  const e = [], lines = c.split('\n');
  if (c !== c.trim()) e.push('leading/trailing whitespace');
  if (/ {2,}/.test(c)) e.push('double spaces');
  if (/\n\s*\n/.test(c)) e.push('raw blank line (must use spacer)');
  if (lines.some(l => l !== l.trim())) e.push('line with edge whitespace');
  const blocks = c.split(`\n${SPACER}\n`);
  if (blocks.some(b => b.includes(SPACER))) e.push('stray spacer');
  const n = blocks.length; // hook + 3-4 paras + source + closing question (or the legacy brief CTA) + hashtags
  if (n < 7 || n > 8) e.push(`block count ${n} (want hook + 3-4 paragraphs + source + closing question + hashtags)`);
  if (!/^\p{Extended_Pictographic}/u.test(blocks[0] || '')) e.push('hook must start with emoji');
  if (blocks.slice(0, -1).some(b => b.split('\n').length > 1)) e.push('paragraph contains line break');
  const src = blocks[n - 3] || '';
  if (!/^Source: [^·\n]+ · https?:\/\/\S+$/.test(src)) e.push('source line malformed');
  if (!isCloser(blocks[n - 2] || '')) e.push('closing question line malformed (one short question, alone after a spacer below Source)');
  if ((c.match(/https?:\/\//g) || []).length !== 1) e.push('URL must appear exactly once');
  if (!/^(#[A-Za-z0-9]+ ){4}#[A-Za-z0-9]+$/.test(blocks[n - 1] || '')) e.push('hashtag line must be exactly 5 tags');
  if ((c.match(/#[A-Za-z0-9]+/g) || []).length !== 5) e.push('hashtags outside last line');
  if (/[\u2018\u2019\u201C\u201D\u2013]/.test(c)) e.push('un-normalized quotes/dashes');
  const w = blocks.slice(0, n - 3).join(' ').split(/\s+/).filter(Boolean).length;
  if (w < 70 || w > 230) e.push('IG body words ' + w);
  if (c.length > 2200) e.push('IG caption > 2200 chars');
  return e;
}
function checkLi(c) {
  const e = [];
  if (c !== c.trim()) e.push('edge whitespace');
  if (/\n{3,}/.test(c) || / {2,}/.test(c) || c.includes(SPACER)) e.push('spacing');
  if ((c.match(/https?:\/\//g) || []).length !== 1) e.push('links: want the source URL once');
  if (!c.includes('\nGet the free weekly AI brief at aifeed.run\n')) e.push('weekly brief line missing');
  if (!/\n\n(#[A-Za-z0-9]+ ){4}#[A-Za-z0-9]+$/.test(c)) e.push('hashtag line');
  return e;
}
// ── Accuracy gate: never turn a report/plan/rumor into a fact; keep currency symbols ──
// Source hedges (title + feed description + og:description).
// Case-insensitive: RSS titles are often Title Case ("Considers", "Hopes To").
const SRC_HEDGE_RE = /\b(considers?|considering|weighs?|weighing|mulls?|mulling|explores?|exploring|plans?|planning|planned|in talks|talks (?:to|with|over)|negotiat\w*|reportedly|sources? (?:say|said|says)|people familiar|according to (?:a |the )?(?:report|sources|people)|report(?:s|ed)? (?:say|says|said|that)|rumou?r\w*|might|up to|expected to|set to|seeks?|seeking|nears?|close to|potential(?:ly)?|propos\w+|is said to|aims? to|intends? to|hop(?:es|ing) to|wants? to|looks? to|could)\b/i;
// Lowercase "may" anywhere is a hedge. Title Case "May" mid-headline ("OpenAI May Release") is too,
// unless it reads as the month ("in May", "May 5", "May 2026").
const SRC_MAY_LOWER_RE = /\bmay\b/;
const MONTH_PREP = new Set(['in', 'on', 'since', 'until', 'by', 'last', 'next', 'early', 'late', 'mid', 'of', 'through', 'from', 'to', 'and', 'before', 'after', 'during']);
function titleMayHedge(title) {
  const re = /(\S+)\s+May\b(?![\s-]*\d)/g;
  let m;
  while ((m = re.exec(String(title || '')))) {
    if (!MONTH_PREP.has(m[1].toLowerCase().replace(/[^a-z]/g, ''))) return true;
  }
  return false;
}
// Hedges accepted in generated copy (broader, case-insensitive; graphic headlines are ALL CAPS).
const GEN_HEDGE_RE = /\b(considers?|considering|weighs?|weighing|mulls?|mulling|eyes|eyeing|explores?|exploring|plans?|planning|planned|in talks|talks|negotiat\w*|reportedly|reports?|reported|sources?|rumou?r\w*|may|might|could|would|up to|expected|set to|seeks?|seeking|nears?|close to|potential(?:ly)?|propos\w+|possibl[ey]|said to|aims? to|aiming to|looks? to|looking to|wants? to|hopes? to|intends?|considered)\b|\?/i;
function hedgeSource(c) { return [c && c.title, c && c.desc, c && c.description].filter(Boolean).join(' \n '); }
function srcHasHedge(c) {
  const text = String(hedgeSource(c));
  return SRC_HEDGE_RE.test(text) || SRC_MAY_LOWER_RE.test(text) || titleMayHedge(c && c.title);
}
const BARE_AMOUNT_RE = /(^|[^$€£¥\d.,])(\d[\d.,]*)\s*(billion|million|trillion|bn)\b(?![\s-]*(?:yuan|euros?|pounds?|yen|won|rupees?|dollars?|usd|eur|gbp|rmb|parameters?|params|users?|people|tokens?|downloads?|subscribers?|views?|times|years?|devices?|units?|chips?|gpus?|images?|videos?|messages?|queries|requests?|customers?|members?|monthly|weekly|daily|active))/i;
function checkAccuracy(g, c) {
  const e = [];
  const parts = { headline: normText(g.graphicHeadline), summary: normText(g.summary), hook: normText(g.igHook) };
  if (srcHasHedge(c)) {
    const miss = Object.keys(parts).filter(k => !GEN_HEDGE_RE.test(parts[k]));
    if (miss.length) e.push('source is hedged (report/plan/rumor) but ' + miss.join(' + ') + ' state it as fact');
  }
  const srcText = [c && c.title, c && c.desc, c && c.description, c && c.text].filter(Boolean).join(' ');
  if (/[$]\s?\d/.test(srcText)) {
    for (const k of ['headline', 'summary', 'hook']) { const m = parts[k].match(BARE_AMOUNT_RE); if (m) e.push(`${k} has "${(m[2] + ' ' + m[3]).trim()}" without $ (source uses $)`); }
  }
  return e;
}

module.exports = {
  SPACER, IG_CTA, FB_CTA, Q_PREFIX, QUESTION_FALLBACK, validQuestion, closingQuestion, normText, normTag, tags5, cleanUrl, buildIg, buildFb, buildLi, checkIg, checkFb, checkLi,
  checkAccuracy, srcHasHedge, hedgeSource
};
