// Slot ordering and the strict same-event check. Logic matches the live n8n nodes
// "Pick Slot Story" and "Drop Same-Event Repeats".

function parseRank(txt) {
  let ranked = [];
  try { ranked = JSON.parse((String(txt || '').match(/\[[\s\S]*\]/) || ['[]'])[0]); } catch (e) { ranked = []; }
  return ranked;
}

function orderPool({ slot, today, fresh, history, rankText }) {
  const hist = JSON.parse(JSON.stringify(history || { posted: [], rankings: {} }));
  hist.posted = hist.posted || [];
  hist.rankings = hist.rankings || {};
  const ranked = parseRank(rankText);
  let ordered = ranked.map(r => fresh[parseInt(r.index, 10) - 1]).filter(Boolean);
  if (!ordered.length) ordered = fresh.slice(0, 12);

  if (Number(slot) === 2) {
    const morning = hist.rankings[today];
    if (morning && morning.length) {
      const freshSet = new Set(fresh.map(f => f.canonUrl));
      const fromMorning = morning.filter(m => freshSet.has(m.canonUrl));
      const seen = new Set(fromMorning.map(m => m.canonUrl));
      ordered = [
        ...fromMorning.map(m => fresh.find(f => f.canonUrl === m.canonUrl)),
        ...ordered.filter(o => !seen.has(o.canonUrl))
      ];
    }
  } else {
    hist.rankings[today] = ordered.slice(0, 12).map((o, i) => ({ rank: i + 1, title: o.title, canonUrl: o.canonUrl }));
  }

  const pool = [...ordered];
  for (const f of fresh) {
    if (pool.length >= 15) break;
    if (!pool.some(p => p.canonUrl === f.canonUrl)) pool.push(f);
  }
  pool.splice(15);
  if (!pool.length) throw new Error('No candidates left for slot ' + slot);
  Object.keys(hist.rankings).sort().slice(0, -14).forEach(k => delete hist.rankings[k]);
  return { pool, history: hist, rankings: hist.rankings };
}

function buildSameEventPrompt(pool, postedCompact) {
  const posted = (postedCompact || []).map((p, i) => `P${i + 1}. [${p.date}${p.outlet ? ' ' + p.outlet : ''}] ${p.title}${p.summary && p.src !== 'instagram' ? ' - ' + p.summary : ''}`).join('\n');
  const cands = pool.map((c, i) => `C${i + 1}. ${c.title} (${c.source})${c.desc ? ' - ' + c.desc.slice(0, 200) : ''}`).join('\n');
  return `You are a strict duplicate detector for an AI news account that must NEVER post the same news twice.
For EACH candidate, decide: is it the SAME NEWS EVENT as any item in ALREADY POSTED?
SAME event = same company/organization/person AND the same specific announcement, launch, deal, funding round, lawsuit, incident, research result, report or statement. It is still the same event if it comes from a different outlet, has a different headline or angle, or is a follow-up/analysis piece without a materially new development.
NOT the same event: a different product or announcement from the same company, a clearly new development (e.g. a ruling weeks after a lawsuit was filed), or merely the same general topic.
When unsure whether two items describe the same announcement, answer repeat=true.

ALREADY POSTED (P = posted on aifeed.run / Instagram; newest first):
${posted}

CANDIDATES:
${cands}

Return ONLY a JSON array with one object per candidate, in order:
[{"c": 1, "repeat": true|false, "match": "<P number of the matching posted item, or null>", "why": "<max 12 words>"}]`;
}

function applySameEvent(pool, postedCompact, modelText) {
  const compact = postedCompact || [];
  let verdicts = null;
  try { verdicts = JSON.parse((String(modelText || '').match(/\[[\s\S]*\]/) || [''])[0]); } catch (e) { verdicts = null; }
  if (!Array.isArray(verdicts) || !verdicts.length) {
    throw new Error('Same-event check returned no readable verdict - nothing posted (safety stop)');
  }
  const byC = {};
  verdicts.forEach(v => {
    const n = parseInt(String(v.c ?? v.candidate).replace(/\D/g, ''), 10);
    if (n) byC[n] = v;
  });
  const kept = [];
  const skipped = [];
  pool.forEach((c, i) => {
    const v = byC[i + 1];
    if (!v) { skipped.push({ title: c.title, reason: 'no verdict (treated as repeat)' }); return; }
    const isRep = v.repeat === true || String(v.repeat).toLowerCase() === 'true';
    if (isRep) {
      const m = parseInt(String(v.match || '').replace(/\D/g, ''), 10);
      skipped.push({ title: c.title, reason: 'same event: ' + (v.why || ''), matched: compact[m - 1] ? compact[m - 1].title : (v.match || '') });
    } else kept.push(c);
  });
  const candidates = kept.slice(0, 5);
  if (!candidates.length) {
    throw new Error('All ' + pool.length + ' candidate stories were already posted (same news event) - nothing posted this run. Skipped: ' + skipped.map(s => s.title + ' => ' + (s.matched || s.reason)).join(' | ').slice(0, 900));
  }
  return { candidates, sameEventSkipped: skipped };
}

module.exports = { parseRank, orderPool, buildSameEventPrompt, applySameEvent };
