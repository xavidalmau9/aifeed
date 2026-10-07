// Applies the semantic same-event verdicts: drops repeats, keeps the first 5 non-repeats as the candidates.
// Fails safe (no post) if the verdict is unreadable or every candidate is a repeat.
const { pool, history } = $('Pick Slot Story').first().json;
const compact = $('Fetch RSS + Dedup').first().json.postedCompact;
const txt = $input.first().json?.content?.[0]?.text || '';
let verdicts = null;
try { verdicts = JSON.parse((txt.match(/\[[\s\S]*\]/) || [''])[0]); } catch (e) { verdicts = null; }
if (!Array.isArray(verdicts) || !verdicts.length) throw new Error('Same-event check returned no readable verdict - nothing posted (safety stop)');
const byC = {}; verdicts.forEach(v => { const n = parseInt(String(v.c ?? v.candidate).replace(/\D/g, '')); if (n) byC[n] = v; });
const kept = [], skipped = [];
pool.forEach((c, i) => {
  const v = byC[i + 1];
  if (!v) { skipped.push({ title: c.title, reason: 'no verdict (treated as repeat)' }); return; }
  const isRep = v.repeat === true || String(v.repeat).toLowerCase() === 'true';
  if (isRep) {
    const m = parseInt(String(v.match || '').replace(/\D/g, ''));
    skipped.push({ title: c.title, reason: 'same event: ' + (v.why || ''), matched: compact[m - 1] ? compact[m - 1].title : (v.match || '') });
  } else kept.push(c);
});
const candidates = kept.slice(0, 5);
if (!candidates.length) throw new Error('All ' + pool.length + ' candidate stories were already posted (same news event) - nothing posted this run. Skipped: ' + skipped.map(s => s.title + ' => ' + (s.matched || s.reason)).join(' | ').slice(0, 900));
return [{ json: { candidates, history, sameEventSkipped: skipped } }];
