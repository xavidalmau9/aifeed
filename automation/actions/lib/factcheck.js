// ── Source fact check (shared by the Actions pipeline and the n8n "Source Check" nodes; keep both in sync) ──
// Every generated sentence (graphic headline, summary, IG hook, IG paragraph sentences, LinkedIn copy) is checked
// against the fetched article text (or the RSS description). Unsupported body sentences are dropped while the caption
// keeps enough content, otherwise rewritten once from the source; headline/summary/hook are rewritten once. The
// changed copy is verified again. Anything still unsupported, or a
// verdict that cannot be read, fails the candidate (g.supported = false) so the quality gate falls back to the next
// story, and posts nothing when none remain. Layout is re-checked afterwards by the normal caption checks.
const FC_REQUIRED = { H: 'graphicHeadline', S: 'summary', K: 'igHook' };
function fcSplitSentences(p) {
  const s = String(p || '').replace(/\s+/g, ' ').trim();
  if (!s) return [];
  const prot = s.replace(/\b(U\.S|U\.K|E\.U|U\.N|Inc|Corp|Co|Ltd|Mr|Mrs|Ms|Dr|St|vs|No|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|e\.g|i\.e|approx)\./g, m => m.replace(/\./g, '\u0000'));
  return prot.split(/(?<=[.!?\u2026]["'\u201D\u2019)]*)\s+(?=["'\u201C\u2018(]?[A-Z0-9$\u20AC\u00A3])/).map(x => x.replace(/\u0000/g, '.').trim()).filter(Boolean);
}
// scope "all" = everything that is published; "li" = LinkedIn copy only (used for the LinkedIn expansion).
function fcItems(g, scope) {
  const items = [];
  const add = (id, field, text, pi, si) => { const t = String(text || '').trim(); if (t) items.push({ id, field, text: t, pi, si }); };
  if (scope !== 'li') {
    add('H', 'graphicHeadline', g.graphicHeadline);
    add('S', 'summary', g.summary);
    add('K', 'igHook', g.igHook);
    (g.igParagraphs || []).forEach((p, i) => fcSplitSentences(p).forEach((s, j) => add(`P${i + 1}.${j + 1}`, 'igParagraphs', s, i, j)));
  }
  add('LH', 'liHook', g.liHook);
  (g.liParagraphs || []).forEach((p, i) => fcSplitSentences(p).forEach((s, j) => add(`L${i + 1}.${j + 1}`, 'liParagraphs', s, i, j)));
  add('LT', 'liTakeaway', g.liTakeaway);
  return items;
}
function fcSource(c) {
  c = c || {};
  const parts = ['TITLE: ' + (c.title || '')];
  if (c.desc) parts.push('FEED DESCRIPTION: ' + c.desc);
  if (c.description && c.description !== c.desc) parts.push('PAGE DESCRIPTION: ' + c.description);
  const t = String(c.text || '').trim();
  parts.push('ARTICLE TEXT (truncated): ' + (t.length >= 200 ? t : '(not available - use only the title and descriptions)'));
  return parts.join('\n');
}
// only: optional list of item texts to check (the verify pass re-checks just the rewritten sentences).
function fcSelect(g, scope, only) {
  const items = fcItems(g, scope);
  if (!only) return items;
  const want = new Set(only.map(t => String(t).trim()));
  return items.filter(it => want.has(it.text));
}
function buildFactPrompt(c, g, { allowRewrite = true, scope = 'all', only = null } = {}) {
  const items = fcSelect(g, scope, only);
  const rewriteRule = allowRewrite
    ? `\nFor every item with supported=false also give "rewrite": the same item rewritten using ONLY facts in the SOURCE, same role and similar length (H: ALL CAPS, 4-8 words, max 60 chars; K: starts with the same emoji, max 18 words; S: one sentence, 14-26 words; every other id: one sentence, no emojis). Keep hedges (considers, plans, reportedly, sources say, may, up to) and currency symbols exactly as the SOURCE has them. No URLs, hashtags or line breaks. Use "" when the idea cannot be stated truthfully from the SOURCE (the sentence will be removed).`
    : '';
  return `You are a strict fact checker for AIFeed.run, an AI news account. Check each ITEM against the SOURCE below and nothing else: no outside knowledge, even if you believe the item is true.
supported=true only when every factual claim in the item is stated in, or directly follows from, the SOURCE: who, what, numbers, prices, dates, availability or rollout status (e.g. "rolling out to all users", "available now", "free"), who is affected, comparisons, causes, outcomes, significance claims ("major", "first", "biggest") and quotes. A plan, proposal, report or rumor in the SOURCE must stay hedged in the item. Neutral connecting phrasing that adds no new fact counts as supported. ALL CAPS headlines are judged on meaning.${rewriteRule}

SOURCE:
${fcSource(c)}

ITEMS:
${items.map(it => it.id + ': ' + it.text).join('\n')}

Return ONLY a JSON array with one object per item, using the ids exactly as given, in order:
[{"id": "H", "supported": true, "why": "<max 12 words>"${allowRewrite ? ', "rewrite": ""' : ''}}]`;
}
function fcParse(text) {
  try {
    const arr = JSON.parse((String(text || '').replace(/```json|```/g, '').match(/\[[\s\S]*\]/) || [''])[0]);
    return Array.isArray(arr) ? arr : null;
  } catch (e) { return null; }
}
// Same floor as the IG layout check (3+ paragraphs, 70+ body words) with a small margin.
function fcIgEnough(hook, igParagraphs) {
  const paras = (igParagraphs || []).filter(p => String(p).trim());
  if (paras.length < 3) return false;
  return [hook, ...paras].join(' ').split(/\s+/).filter(Boolean).length >= 75;
}
function fcCleanRewrite(r) {
  const t = String(r == null ? '' : r).replace(/\s+/g, ' ').trim();
  if (!t || /https?:\/\/|(^|\s)#\w|\n/.test(t)) return '';
  return t;
}
// Applies one verdict response to a candidate (mutates g). Returns { status: 'pass'|'patched'|'fail', problems, changes }.
function applyFactVerdicts(g, text, { allowRewrite = true, scope = 'all', only = null } = {}) {
  const items = fcSelect(g, scope, only);
  const fail = reason => {
    g.supported = false;
    g.issues = 'source check: ' + reason;
    return { status: 'fail', problems: [reason], changes: [], rewritten: [] };
  };
  if (only && only.length && items.length < new Set(only).size) return fail('rewritten sentence missing after rebuild');
  if (!items.length) return { status: 'pass', problems: [], changes: [], rewritten: [] };
  const arr = fcParse(text);
  if (!arr) return fail('fact-check response unreadable');
  const byId = {};
  arr.forEach(v => { if (v && v.id != null) byId[String(v.id).trim()] = v; });
  const missing = items.filter(it => !byId[it.id]).map(it => it.id);
  if (missing.length) return fail('fact-check response missing ' + missing.slice(0, 6).join(', '));
  const bad = items.filter(it => !(byId[it.id].supported === true || String(byId[it.id].supported).toLowerCase() === 'true'));
  if (!bad.length) return { status: 'pass', problems: [], changes: [], rewritten: [] };
  const problems = bad.map(it => `${it.id} "${it.text.slice(0, 90)}" (${String(byId[it.id].why || 'unsupported').slice(0, 80)})`);
  if (!allowRewrite) return fail('still unsupported after rewrite: ' + problems.join('; '));
  const changes = [];
  const rewritten = [];
  const paras = { igParagraphs: (g.igParagraphs || []).map(fcSplitSentences), liParagraphs: (g.liParagraphs || []).map(fcSplitSentences) };
  const joined = f => paras[f].map(ss => ss.filter(Boolean).join(' ')).filter(Boolean);
  for (const it of bad) {
    const rw = fcCleanRewrite(byId[it.id].rewrite);
    if (FC_REQUIRED[it.id]) {
      if (!rw) return fail(`${it.id} unsupported and no usable rewrite: ` + problems.join('; '));
      g[it.field] = rw;
      rewritten.push(rw);
      changes.push(`rewrote ${it.id}`);
    } else if (it.field === 'igParagraphs' || it.field === 'liParagraphs') {
      // Prefer dropping a body sentence (adds no new text); rewrite only when the IG caption would get too thin.
      const keep = paras[it.field][it.pi][it.si];
      paras[it.field][it.pi][it.si] = '';
      if (it.field === 'igParagraphs' && rw && !fcIgEnough(g.igHook, joined('igParagraphs'))) {
        paras[it.field][it.pi][it.si] = rw;
        rewritten.push(rw);
        changes.push('rewrote ' + it.id);
      } else changes.push('dropped ' + it.id);
      if (!keep) changes.pop();
    } else {
      g[it.field] = '';
      changes.push('dropped ' + it.id);
    }
  }
  for (const f of ['igParagraphs', 'liParagraphs']) {
    if (g[f]) g[f] = joined(f);
  }
  g.sourceCheck = changes.join(', ');
  return { status: 'patched', problems, changes, rewritten };
}
// ---- end of shared source-check code ----

// Runs the full check for one candidate with an injected model call: check + rewrite, then verify the rewritten copy.
async function sourceCheckCandidate({ c, g, ask, scope = 'all' }) {
  let text = '';
  try { text = await ask(buildFactPrompt(c, g, { allowRewrite: true, scope })); } catch (e) { text = ''; }
  const r1 = applyFactVerdicts(g, text, { allowRewrite: true, scope });
  if (r1.status !== 'patched' || !r1.rewritten.length) return r1; // drops add no new text: nothing to re-verify
  let text2 = '';
  try { text2 = await ask(buildFactPrompt(c, g, { allowRewrite: false, scope, only: r1.rewritten })); } catch (e) { text2 = ''; }
  const r2 = applyFactVerdicts(g, text2, { allowRewrite: false, scope, only: r1.rewritten });
  if (r2.status === 'fail') return r2;
  return r1;
}

// Verify-only (no rewrite) for copy that was already regenerated once, e.g. the accuracy (hedge/$) fix.
async function verifyCandidate({ c, g, ask }) {
  let text = '';
  try { text = await ask(buildFactPrompt(c, g, { allowRewrite: false })); } catch (e) { text = ''; }
  return applyFactVerdicts(g, text, { allowRewrite: false });
}

// Checks every candidate that is still eligible (parallel). Returns the patched copy of gen plus a log.
async function sourceCheckAll({ gen, usable, ask, keys }) {
  const out = JSON.parse(JSON.stringify(gen || []));
  const wanted = keys ? new Set(keys) : null;
  const log = [];
  await Promise.all(out.map(async g => {
    const c = usable[g.candidate];
    if (!c || !g.supported || !g.safe) return;
    if (wanted && !wanted.has(g.candidate)) return;
    const r = await sourceCheckCandidate({ c, g, ask });
    log.push({ candidate: g.candidate, title: c.title, status: r.status, changes: r.changes, problems: r.problems });
  }));
  log.sort((a, b) => a.candidate - b.candidate);
  return { gen: out, log };
}

// Verify-only check of the LinkedIn expansion (website body). Unsupported or unreadable -> keep the checked original.
async function checkLiExpansion({ c, gen, expandedText, ask }) {
  let p;
  try { p = JSON.parse((String(expandedText || '').match(/\{[\s\S]*\}/) || ['{}'])[0]); } catch (e) { return { ok: false, reason: 'expansion unparseable' }; }
  if (!p || !Array.isArray(p.liParagraphs)) return { ok: false, reason: 'expansion has no paragraphs' };
  const g = Object.assign({}, gen, { liHook: p.liHook || gen.liHook, liParagraphs: p.liParagraphs, liTakeaway: p.liTakeaway || gen.liTakeaway });
  let text = '';
  try { text = await ask(buildFactPrompt(c, g, { allowRewrite: false, scope: 'li' })); } catch (e) { text = ''; }
  const r = applyFactVerdicts(g, text, { allowRewrite: false, scope: 'li' });
  return r.status === 'pass' ? { ok: true, expansion: p } : { ok: false, reason: r.problems.join('; ').slice(0, 300) };
}

module.exports = {
  FC_REQUIRED, fcSplitSentences, fcIgEnough, fcItems, fcSelect, fcSource, buildFactPrompt, fcParse, applyFactVerdicts,
  sourceCheckCandidate, verifyCandidate, sourceCheckAll, checkLiExpansion
};
