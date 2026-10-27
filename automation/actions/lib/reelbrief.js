// Reel brief: one short LLM call (the pipeline's existing Anthropic model) that writes the Reel's punch headline and a
// story-themed scene prompt. make_reel.py validates both and falls back to its rule-based punch + theme map, so a
// failed/invalid brief never blocks a Reel.
const BANNED = /\b(daily|hand[- ]?edited|human[- ]?edited|edited by|our editors?)\b/i;

// v3 (opt-in: config reelTemplate "v3"): the brief also writes three hook variants for the A/B test and a save-worthy
// takeaway for the end card. Not requested for v2, so the live prompt/answer is unchanged until v3 is rolled out.
const V3_PROMPT = `
Also add to the same JSON object: "hooks": {"A": "...", "B": "...", "C": "..."}, "takeaway": "..."
- hooks: three alternative cover headlines in the SAME punch format (2-4 lines split by " / ", each at most 16 characters,
  exactly ONE line prefixed with "*", ALL-CAPS, facts only from the headline and summary, no word "daily"):
  A = a bold claim stating the payoff (no question mark);
  B = a question the story answers, ending with "?" (e.g. "IS COREWEAVE'S / *DEBT ABOUT / TO BITE?");
  C = what this means for the viewer, may address "YOU"/"YOUR" (e.g. "YOUR AI BILL / *COULD RISE / AFTER THIS"), no question mark.
- takeaway: ONE plain sentence (at most 90 characters) a viewer would save: the single most useful fact or implication,
  stated only from the story's facts. No hashtags, no emoji.`;

function buildReelBriefPrompt(post, opts = {}) {
  const body = String(post.summary || '').slice(0, 600);
  return `You design the cover of a vertical news Reel for @aifeed.run (US tech/AI news, poster style).
Story headline: ${post.headline}
Category: ${post.category || ''}
Summary: ${body}

Return ONLY JSON: {"punch": "...", "scene": "...", "keywords": ["...", "..."]}
- punch: a short, punchy ALL-CAPS headline for the cover, 3 or 4 lines separated by " / ", each line at most 16 characters.
  Prefix exactly ONE line with "*" (the accent line, usually the key fact or verb phrase). The lines must read top to bottom
  as ONE natural, grammatical sentence that keeps the headline's subject and main verb (a compressed headline, not a list
  of keywords). Use only facts stated in the headline and summary: never add a claim or a loaded word that the story does
  not state (e.g. do not say "breach" or "hack" unless the story does). Keep company names; no clickbait; no question unless
  the headline is one; never use the word "daily".
  Never repeat a word or its root across the lines (bad: "CREDIT STRESS / HITS DISTRESS", "AI ... / AI ..."; each word once).
  ONE clause only: never stack two fragments (bad: "WE WERE WRONG / *LLMS EASIER / TO UNDERSTAND / THAN THOUGHT" = a quote
  plus a verbless fragment; good: "*LLMS ARE / EASIER TO READ / THAN WE / THOUGHT" or "RESEARCHERS / *FIND LLMS / EASIER TO / DECODE").
  Write in third person: never open with a quote or with WE / I / YOU / OUR. Keep the verb ("ARE", "IS", "HITS");
  do not drop it to save space. The accent line carries the news (the key fact or verb phrase), not a filler word.
  Example: "COREWEAVE / *CREDIT SWAPS / HIT DISTRESS / OVER DEBT"
- scene: one sentence describing a dramatic, photorealistic scene that matches the story's THEME (not just its category),
  as a visual metaphor a top US news outlet would use. Examples: credit/debt stress -> "a stressed trader in shadow, head in hand,
  before monitors of red crashing charts"; genomics limits -> "a tangled, glitching DNA helix hologram in a dark lab, a scientist
  silhouette from behind". No text, no logos, no real identifiable people (silhouettes or faces hidden only), no brand names.
  Never include objects that usually carry writing: no signs, signage, lecterns, podiums, name plates, laptops, phones,
  documents, newspapers, books, posters, banners, billboards, storefronts, labels, dashboards or screens with words or numbers.
  Prefer one bold physical subject or abstract light (a helix, a microphone, chart lines, a silhouette) in a dark space.
- keywords: 2 short photo-search phrases for a real photo of the same theme (e.g. "stock market crash screen").` + (opts.v3 ? V3_PROMPT : '');
}

// A v3 hook variant: punch format (one-line-per-'/' <= 22 chars, one '*' line), no banned words or repeated roots,
// B must be a question and A/C must not. YOU/YOUR openers are allowed (C talks to the viewer).
function validHook(p, style) {
  if (typeof p !== 'string') return false;
  const lines = p.split('/').map(s => s.trim()).filter(Boolean);
  const q = /\?\s*$/.test(p);
  return lines.length >= 2 && lines.length <= 4 && lines.filter(l => l.startsWith('*')).length === 1
    && lines.every(l => l.replace(/^\*/, '').length <= 22) && !BANNED.test(p) && repeatedRoots(p).length === 0
    && (style === 'B' ? q : !q);
}

// Root of a word for repetition checks: "distress" -> "stress", "tags"/"tagged" -> "tag", "AI" -> "ai".
const STOP = new Set(['a', 'an', 'the', 'of', 'to', 'for', 'in', 'on', 'at', 'by', 'and', 'or', 'with', 'as', 'is', 'are', 'its', 'from', 'over', 'into']);
function wordRoot(w) {
  let r = String(w).toLowerCase().replace(/[^a-z0-9]/g, '');
  const pre = r.match(/^(dis|un|re|non|over|under|mis)(.{4,})$/);
  if (pre) r = pre[2];
  for (const suf of ['ings', 'ing', 'ed', 'es', 's', 'ly', 'er']) {
    if (r.length - suf.length >= 3 && r.endsWith(suf)) { r = r.slice(0, -suf.length); break; }
  }
  return r.replace(/(.)\1$/, '$1');
}
// Same root: identical, or one contains the other as a prefix/suffix (stress/distress, label/relabel), ignoring short roots.
function sameRoot(a, b) {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length < 4 || !(l.startsWith(s) || l.endsWith(s))) return false;
  return s.length >= 5 || l.length - s.length <= 3;
}
// Words of a punch whose root already appeared earlier (e.g. ['DISTRESS'] for "CREDIT STRESS / HITS DISTRESS").
function repeatedRoots(p) {
  const seen = new Set(); const rep = [];
  for (const w of String(p || '').replace(/[*/]/g, ' ').split(/[\s-]+/).filter(Boolean)) {
    const raw = w.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!raw || STOP.has(raw)) continue;
    const r = wordRoot(w);
    if ([...seen].some(x => sameRoot(x, r))) rep.push(w); else seen.add(r);
  }
  return rep;
}

// Choppy-punch guard: a first-person/quote opener ("WE WERE WRONG / ...") reads as two fragments on the cover.
const QUOTE_OPENER = /^\s*\*?\s*["'‘’“”]|^\s*\*?\s*(WE|I|YOU|OUR|MY|US)\b/i;
function choppyPunch(p) {
  return QUOTE_OPENER.test(String(p || ''));
}

function validPunch(p) {
  if (typeof p !== 'string') return false;
  const lines = p.split('/').map(s => s.trim()).filter(Boolean);
  return lines.length >= 2 && lines.length <= 4 && lines.filter(l => l.startsWith('*')).length === 1
    && lines.every(l => l.replace(/^\*/, '').length <= 22) && !BANNED.test(p) && repeatedRoots(p).length === 0 && !choppyPunch(p);
}

function parseReelBrief(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return {};
  let j;
  try { j = JSON.parse(m[0]); } catch (e) { return {}; }
  const out = {};
  if (validPunch(j.punch)) out.punch = j.punch.split('/').map(s => s.trim()).filter(Boolean).map(s => s.toUpperCase()).join(' / ');
  if (typeof j.scene === 'string' && j.scene.trim().length >= 20 && !BANNED.test(j.scene)) out.scenePrompt = j.scene.trim().slice(0, 400);
  if (j.hooks && typeof j.hooks === 'object') {
    const hooks = {}, src = {};
    for (const [k, v] of Object.entries(j.hooks)) src[String(k).trim().toUpperCase()] = v;
    for (const k of ['A', 'B', 'C']) {
      if (validHook(src[k], k)) hooks[k] = src[k].split('/').map(s => s.trim()).filter(Boolean).map(s => s.toUpperCase()).join(' / ');
    }
    if (Object.keys(hooks).length) out.hooks = hooks;
  }
  if (typeof j.takeaway === 'string' && j.takeaway.trim().length >= 15 && j.takeaway.trim().length <= 95 && !BANNED.test(j.takeaway)) out.takeaway = j.takeaway.trim();
  if (Array.isArray(j.keywords)) out.sceneKeywords = j.keywords.filter(k => typeof k === 'string' && k.trim()).map(k => k.trim().slice(0, 60)).slice(0, 3);
  return out;
}

// One retry when the punch is missing/invalid (e.g. a repeated root word); if the retry fails too, the brief carries no
// punch and make_reel.py uses its rule-based punch. The scene from the first answer is kept if the retry has none.
async function reelBrief(post, ask, opts = {}) {
  let out = {};
  try {
    const first = await ask(buildReelBriefPrompt(post, opts));
    out = parseReelBrief(first);
    if (out.punch) return out;
    const m = String(first || '').match(/"punch"\s*:\s*"([^"]*)"/);
    const why = m && repeatedRoots(m[1]).length ? `it repeated the root word(s) ${repeatedRoots(m[1]).join(', ')}`
      : m && choppyPunch(m[1]) ? 'it opens with a quote or first-person words (WE/I/YOU) and reads as two fragments; write ONE third-person clause'
      : 'it broke the format rules';
    const retry = parseReelBrief(await ask(buildReelBriefPrompt(post, opts) +
      `\n\nYour previous punch ${m ? JSON.stringify(m[1]) + ' ' : ''}was rejected because ${why}. Write a new one that follows every rule.`));
    return { ...out, ...retry };
  } catch (e) {
    return out;
  }
}

module.exports = { buildReelBriefPrompt, parseReelBrief, validPunch, validHook, choppyPunch, repeatedRoots, wordRoot, reelBrief };
