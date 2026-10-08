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
function buildIg(g, url) {
  const hook = normText(g.igHook), paras = (g.igParagraphs || []).map(normText).filter(Boolean).slice(0, 4), tg = tags5(g.igHashtags);
  const blocks = [hook, ...paras, `Source: ${normText(g.outlet)} · ${cleanUrl(url)}`, '📩 Free weekly AI brief → link in bio', tg.map(t => '#' + t).join(' ')];
  return blocks.join(`\n${SPACER}\n`);
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
  const n = blocks.length; // hook + 3-4 paras + source + brief CTA + hashtags
  if (n < 7 || n > 8) e.push(`block count ${n} (want hook + 3-4 paragraphs + source + brief CTA + hashtags)`);
  if (!/^\p{Extended_Pictographic}/u.test(blocks[0] || '')) e.push('hook must start with emoji');
  if (blocks.slice(0, -1).some(b => b.split('\n').length > 1)) e.push('paragraph contains line break');
  const src = blocks[n - 3] || '';
  if (!/^Source: [^·\n]+ · https?:\/\/\S+$/.test(src)) e.push('source line malformed');
  if ((blocks[n - 2] || '') !== '📩 Free weekly AI brief → link in bio') e.push('brief CTA line malformed (must sit alone after a spacer below Source)');
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
// Source hedges (title + feed description + og:description). Lowercase "may" only, so the month "May" does not count.
const SRC_HEDGE_RE = /\b(considers?|considering|weighs?|weighing|mulls?|mulling|explores?|exploring|plans?|planning|planned|in talks|talks (?:to|with|over)|negotiat\w*|reportedly|sources? (?:say|said|says)|people familiar|according to (?:a |the )?(?:report|sources|people)|report(?:s|ed)? (?:say|says|said|that)|rumou?r\w*|might|up to|expected to|set to|seeks?|seeking|nears?|close to|potential(?:ly)?|propos\w+|is said to|aims? to|intends? to|could)\b|\bmay\b/;
// Hedges accepted in generated copy (broader, case-insensitive; graphic headlines are ALL CAPS).
const GEN_HEDGE_RE = /\b(considers?|considering|weighs?|weighing|mulls?|mulling|eyes|eyeing|explores?|exploring|plans?|planning|planned|in talks|talks|negotiat\w*|reportedly|reports?|reported|sources?|rumou?r\w*|may|might|could|would|up to|expected|set to|seeks?|seeking|nears?|close to|potential(?:ly)?|propos\w+|possibl[ey]|said to|aims? to|aiming to|looks? to|looking to|wants? to|hopes? to|intends?|considered)\b|\?/i;
function hedgeSource(c) { return [c && c.title, c && c.desc, c && c.description].filter(Boolean).join(' \n '); }
function srcHasHedge(c) { return SRC_HEDGE_RE.test(String(hedgeSource(c)).replace(/(^|[.!?]\s+)May\b/g, '$1')); }
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
