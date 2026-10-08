// Slot ordering and the strict same-event check. Logic matches the live n8n nodes
// "Pick Slot Story", "Same-Event Verify" and "Drop Same-Event Repeats".

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

// Same-event check lives in lib/sameevent.js (shared with the n8n fallback).
const { buildSameEventPrompt, classifySameEvent, finalizeSameEvent } = require('./sameevent');

// Convenience for tests and callers that already have the confirm answers ({ [poolIndex]: text }).
function applySameEvent(pool, postedCompact, modelText, confirmTexts) {
  return finalizeSameEvent(pool, classifySameEvent(pool, postedCompact, modelText), confirmTexts || {});
}

module.exports = { parseRank, orderPool, buildSameEventPrompt, classifySameEvent, finalizeSameEvent, applySameEvent };
