// Same-event check (shared by GitHub Actions and the n8n fallback; automation/n8n/sync_same_event.py inlines
// everything above the end marker into the n8n Code nodes, and test/n8n-fallback.test.js fails on drift).
//
// 1. One Claude call returns, per candidate: repeat yes/no, the matched posted item (P number + title),
//    the shared company/entity and the shared event.
// 2. A "repeat" is accepted only if the matched posted item exists AND it shares a key entity with the
//    candidate (same company/organization/person, aliases like ChatGPT -> OpenAI included).
// 3. Otherwise (matched item unrelated, or no resolvable match) one confirming call checks just that single
//    pair. same=true or unsure -> repeat; same=false -> the candidate is new.
// 4. A candidate with no verdict counts as a repeat; an unreadable answer (first call or confirm) stops the run.

const SE_STOP = new Set(('a an the of to in on for and or with is are was were be been being by at from as its it this that these those '
  + 'new says said say after over into how why what who when where which will can could would should may might must just now '
  + 'about up out off than then their they them his her he she we you your our us not no yes more most less much many '
  + 'report reports reported reportedly amid via vs here there has have had do does did get gets got make makes made '
  + 'launch launches launched launching announce announces announced unveil unveils unveiled release releases released '
  + 'rolls rolling roll rollout begins begin starts start started adds add added brings bring gives give takes take '
  + 'again another all any some every each other others own only also even still yet very too big bigger biggest '
  + 'first next last latest early soon today week weeks year years day days month months time times '
  + 'one two three four five ten hundred hundreds thousand thousands million millions billion billions trillion '
  + 'ai artificial intelligence generative genai llm llms model models agent agents agentic chatbot chatbots bot bots assistant '
  + 'tool tools app apps feature features update updates upgrade upgraded upgrades version tech technology company companies '
  + 'startup startups firm firms giant giants maker makers deal deals funding round raises raise raised valuation worth '
  + 'buys buy bought acquire acquires acquired acquiring acquisition sells sell sale plan plans planning wants want '
  + 'users user people customers developers researchers research study studies paper data center centers chip chips '
  + 'power energy cost costs price prices free paid pro plus open source closed safety security privacy risk risks '
  + 'test tests testing tested available availability globally global worldwide everyone anyone improved better faster '
  + 'smarter powerful advanced major huge massive key top best worst bad good real fake using use uses used help helps '
  + 'work works working way ways thing things move moves push pushes calls call called show shows showing shown '
  + 'lets let like now news story stories inside behind under across against between without within around back '
  + 'online web internet search video videos image images photo photos voice text chat chats ads ad '
  + 'government federal state states law laws rule rules court lawsuit sues sued judge '
  + 'build builds built building create creates created creating detect detects detector detection content made'
).split(/\s+/));
const SE_ALIAS = {
  chatgpt: 'openai', sora: 'openai', altman: 'openai', codex: 'openai', gpt: 'openai',
  gemini: 'google', deepmind: 'google', alphabet: 'google', youtube: 'google', bard: 'google', synthid: 'google', android: 'google',
  claude: 'anthropic', copilot: 'microsoft', bing: 'microsoft', azure: 'microsoft', nadella: 'microsoft',
  llama: 'meta', instagram: 'meta', whatsapp: 'meta', facebook: 'meta', zuckerberg: 'meta',
  grok: 'xai', aws: 'amazon', alexa: 'amazon', siri: 'apple', iphone: 'apple', huang: 'nvidia'
};
function seTokens(text) {
  return String(text || '').toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'").replace(/'s\b/g, '')
    .split(/[^a-z0-9]+/)
    .map(w => SE_ALIAS[w] || w)
    .filter(w => w.length >= 3 && !/^\d+$/.test(w) && !SE_STOP.has(w));
}
// Money amounts >= $100M, normalized ("$8B", "8 billion", "$8,000 million" -> "$8000m"). The same big amount on
// both sides is treated like a shared key entity ("chipmaker buys Fei-Fei Li's startup for $8B" = AMD/World Labs).
function seAmounts(text) {
  const out = new Set();
  const re = /(\$\s?)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(trillion|billion|million|bn|tn|mn|[btm])\b/gi;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const unit = m[3].toLowerCase();
    if (/^[btm]$/.test(unit) && !m[1]) continue; // bare "8b" / "5m" needs a $ sign
    const mult = /^t/.test(unit) ? 1e6 : /^b/.test(unit) ? 1e3 : 1;
    const v = Math.round(parseFloat(m[2].replace(/,/g, '')) * mult * 10) / 10;
    if (v >= 100) out.add('$' + v + 'm');
  }
  return out;
}
function seSet(...texts) { const s = new Set(); texts.forEach(t => seTokens(t).forEach(w => s.add(w))); return s; }
function seCandText(c) { return [c && c.title, c && c.desc ? String(c.desc).slice(0, 300) : ''].join(' \n '); }
function sePostedText(p) { return [p && p.title, p && p.summary].join(' \n '); }

// Key entities shared by a candidate and a posted item: non-generic words in BOTH titles, the same big money
// amount, plus the model-named entity when all of its words appear on both sides (title + description/summary).
function sharedEntities(cand, posted, modelEntities) {
  const cTitle = seSet(cand && cand.title), cAll = seSet(seCandText(cand));
  const pTitle = seSet(posted && posted.title), pAll = seSet(sePostedText(posted));
  const out = new Set();
  cTitle.forEach(w => { if (pTitle.has(w)) out.add(w); });
  const pAmt = seAmounts(sePostedText(posted));
  seAmounts(seCandText(cand)).forEach(a => { if (pAmt.has(a)) out.add(a); });
  (Array.isArray(modelEntities) ? modelEntities : [modelEntities]).filter(Boolean).forEach(e => {
    const toks = seTokens(e);
    if (toks.length && toks.every(w => cAll.has(w) && pAll.has(w))) toks.forEach(w => out.add(w));
  });
  return [...out];
}

function sePostedLine(p, i) {
  return `P${i + 1}. [${p.date || ''}${p.outlet ? ' ' + p.outlet : ''}] ${p.title}${p.summary && p.src !== 'instagram' ? ' - ' + p.summary : ''}`;
}
function seCandLine(c, i) {
  return `C${i + 1}. ${c.title} (${c.source || ''})${c.desc ? ' - ' + String(c.desc).slice(0, 200) : ''}`;
}

function buildSameEventPrompt(pool, postedCompact) {
  const posted = (postedCompact || []).map(sePostedLine).join('\n');
  const cands = (pool || []).map(seCandLine).join('\n');
  return `You are a strict duplicate detector for an AI news account that must NEVER post the same news twice.
For EACH candidate, decide: is it the SAME NEWS EVENT as a specific item in ALREADY POSTED?
SAME event = same company/organization/person AND the same specific announcement, launch, deal, funding round, lawsuit, incident, research result, report or statement. It is still the same event if it comes from a different outlet, has a different headline or angle, or is a follow-up/analysis piece without a materially new development.
NOT the same event: a different product or announcement from the same company, a clearly new development (e.g. a ruling weeks after a lawsuit was filed), or merely the same general topic.
Compare each candidate ONLY with the ALREADY POSTED items (P numbers). Never compare candidates with each other: two candidates about the same news are NOT repeats unless that news is already in ALREADY POSTED.
A repeat must name the ONE posted item it repeats (its P number, and its title copied exactly), the company/organization/person both are about, and the shared event.
When unsure whether a candidate and a posted item describe the same announcement, answer repeat=true.

ALREADY POSTED (P = posted on aifeed.run / Instagram; newest first):
${posted}

CANDIDATES:
${cands}

Return ONLY a JSON array with one object per candidate, in order:
[{"c": 1, "repeat": true|false, "match": "<P number, or null>", "matchTitle": "<title of that P item copied exactly, or null>", "entity": "<company/organization/person shared by the candidate and that P item, or null>", "event": "<the shared event in max 10 words, or null>", "why": "<max 12 words>"}]`;
}

function seParseArray(text) {
  let v = null;
  try { v = JSON.parse((String(text || '').match(/\[[\s\S]*\]/) || [''])[0]); } catch (e) { v = null; }
  return Array.isArray(v) && v.length ? v : null;
}
function seTrue(x) { return x === true || String(x).toLowerCase() === 'true'; }
function seNorm(t) { return seTokens(t).join(' '); }
function seTitleClose(a, b) {
  const A = new Set(seTokens(a)), B = new Set(seTokens(b));
  if (!A.size || !B.size) return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  let i = 0; A.forEach(w => { if (B.has(w)) i++; });
  return i / Math.min(A.size, B.size) >= 0.6;
}

// The posted item the model meant: its P number, corrected by matchTitle when the number points elsewhere.
function resolveMatch(v, compact) {
  const n = parseInt(String(v.match == null ? '' : v.match).replace(/\D/g, ''), 10);
  const byNum = n && compact[n - 1] ? { idx: n - 1, item: compact[n - 1] } : null;
  const mt = v.matchTitle && String(v.matchTitle).toLowerCase() !== 'null' ? String(v.matchTitle) : '';
  if (mt) {
    if (byNum && seTitleClose(mt, byNum.item.title)) return byNum;
    const idx = compact.findIndex(p => seNorm(p.title) === seNorm(mt));
    if (idx >= 0) return { idx, item: compact[idx] };
    const close = compact.findIndex(p => seTitleClose(mt, p.title));
    if (close >= 0) return { idx: close, item: compact[close] };
  }
  return byNum;
}
// No resolvable match: the posted item sharing the most key entities with the candidate (newest on ties).
function bestPair(cand, compact, entity) {
  let best = null, bestN = -1;
  compact.forEach((p, idx) => {
    const n = sharedEntities(cand, p, entity).length;
    if (n > bestN) { best = { idx, item: p }; bestN = n; }
  });
  return best;
}

function buildConfirmPrompt(cand, posted) {
  return `You check ONE pair for an AI news account that must never post the same news twice.

CANDIDATE: ${cand.title} (${cand.source || ''})${cand.desc ? ' - ' + String(cand.desc).slice(0, 300) : ''}
ALREADY POSTED: [${posted.date || ''}${posted.outlet ? ' ' + posted.outlet : ''}] ${posted.title}${posted.summary ? ' - ' + posted.summary : ''}

Is the candidate the SAME news event as the posted item?
SAME = same company/organization/person AND the same specific announcement, launch, deal, funding round, lawsuit, incident, research result, report or statement. A different outlet, headline or angle, or a follow-up without a materially new development, is still the SAME event.
NOT the same: a different product or announcement from the same company, a clearly new development, or merely the same general topic.
Headlines may describe a company without naming it (e.g. "chipmaker", "Fei-Fei Li's startup", "ChatGPT maker"): if the details (people, amounts, products, timing) fit the posted item, it is the SAME event.
Answer same=false ONLY when they are clearly about different companies or clearly different announcements. If you are unsure, answer same=true.

Return ONLY JSON: {"same": true|false, "entity": "<company/organization/person both are about, or null>", "event": "<the shared event, or null>", "why": "<max 12 words>"}`;
}
function parseConfirm(text) {
  let v = null;
  try { v = JSON.parse((String(text || '').match(/\{[\s\S]*\}/) || [''])[0]); } catch (e) { v = null; }
  if (!v || !(typeof v.same === 'boolean' || /^(true|false)$/i.test(String(v.same)))) return null;
  return { same: seTrue(v.same), entity: v.entity || null, event: v.event || null, why: v.why || '' };
}

// Step 1: classify every pool candidate from the first verdict. Throws on an unreadable answer.
function classifySameEvent(pool, postedCompact, modelText) {
  const compact = postedCompact || [];
  const verdicts = seParseArray(modelText);
  if (!verdicts) throw new Error('Same-event check returned no readable verdict - nothing posted (safety stop)');
  const byC = {};
  verdicts.forEach(v => {
    const n = parseInt(String(v && (v.c ?? v.candidate)).replace(/\D/g, ''), 10);
    if (n) byC[n] = v;
  });
  return (pool || []).map((c, i) => {
    const v = byC[i + 1];
    if (!v) return { i, status: 'repeat', title: c.title, reason: 'no verdict (treated as repeat)' };
    if (!seTrue(v.repeat)) return { i, status: 'new', title: c.title };
    const m = resolveMatch(v, compact);
    const base = { i, title: c.title, why: v.why || '', entity: v.entity || null, event: v.event || null };
    if (m) {
      const shared = sharedEntities(c, m.item, v.entity);
      if (shared.length) {
        return Object.assign(base, { status: 'repeat', matchIdx: m.idx, matched: m.item.title, shared,
          reason: 'same event: ' + (v.event || v.why || '') + ' [shared: ' + shared.join(', ') + ']' });
      }
      return Object.assign(base, { status: 'confirm', matchIdx: m.idx, matched: m.item.title,
        note: 'model match shares no key entity', prompt: buildConfirmPrompt(c, m.item) });
    }
    const p = bestPair(c, compact, v.entity);
    if (!p) return Object.assign(base, { status: 'new', note: 'repeat verdict but no posted history' });
    return Object.assign(base, { status: 'confirm', matchIdx: p.idx, matched: p.item.title,
      note: 'model match ' + JSON.stringify(v.match) + ' not in history; confirming closest posted item', prompt: buildConfirmPrompt(c, p.item) });
  });
}

// Step 2: apply confirm answers ({ [poolIndex]: text }). Unreadable confirm -> throws (nothing posted).
function finalizeSameEvent(pool, classified, confirmTexts) {
  const kept = [], skipped = [], overturned = [];
  classified.forEach(r => {
    const c = pool[r.i];
    if (r.status === 'new') { kept.push(c); return; }
    if (r.status === 'repeat') {
      skipped.push({ title: r.title, reason: r.reason, matched: r.matched || '', entity: r.entity || null, event: r.event || null });
      return;
    }
    const ans = parseConfirm(confirmTexts && confirmTexts[r.i]);
    if (!ans) throw new Error('Same-event confirm check returned no readable verdict for "' + String(r.title).slice(0, 80) + '" - nothing posted (safety stop)');
    if (ans.same) {
      skipped.push({ title: r.title, reason: 'confirmed same event: ' + (ans.event || ans.why || ''), matched: r.matched, entity: ans.entity, event: ans.event });
    } else {
      kept.push(c);
      overturned.push({ title: r.title, wrongMatch: r.matched, note: r.note, why: ans.why });
    }
  });
  const candidates = kept.slice(0, 5);
  if (!candidates.length) {
    throw new Error('All ' + pool.length + ' candidate stories were already posted (same news event) - nothing posted this run. Skipped: ' + skipped.map(s => s.title + ' => ' + (s.matched || s.reason)).join(' | ').slice(0, 900));
  }
  return { candidates, sameEventSkipped: skipped, sameEventOverturned: overturned };
}
// ---- end of shared same-event code ----

module.exports = {
  SE_STOP, SE_ALIAS, seTokens, seAmounts, sharedEntities, buildSameEventPrompt, resolveMatch, buildConfirmPrompt, parseConfirm,
  classifySameEvent, finalizeSameEvent
};
