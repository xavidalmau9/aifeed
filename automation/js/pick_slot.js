// Orders today's candidates (8am -> best story, 5pm -> best story not yet posted; the morning story is already
// removed by the dedupe) and builds the strict same-event prompt for up to 15 candidates.
const cfg = $('Config').first().json;
const base = $('Fetch RSS + Dedup').first().json;
const txt = $input.first().json?.content?.[0]?.text || '';
let ranked = [];
try { ranked = JSON.parse((txt.match(/\[[\s\S]*\]/) || ['[]'])[0]); } catch (e) { ranked = []; }
let ordered = ranked.map(r => base.fresh[parseInt(r.index) - 1]).filter(Boolean);
if (!ordered.length) ordered = base.fresh.slice(0, 12); // Claude failed -> recency order

const history = base.history;
if (cfg.slot === 2) {
  const morning = history.rankings[cfg.today];
  if (morning && morning.length) {
    // Morning ranking first (whatever of it is still unposted/fresh), then anything new from the fresh ranking.
    const fresh = new Set(base.fresh.map(f => f.canonUrl));
    const fromMorning = morning.filter(m => fresh.has(m.canonUrl));
    const seen = new Set(fromMorning.map(m => m.canonUrl));
    ordered = [...fromMorning.map(m => base.fresh.find(f => f.canonUrl === m.canonUrl)), ...ordered.filter(o => !seen.has(o.canonUrl))];
  }
} else {
  history.rankings[cfg.today] = ordered.slice(0, 12).map((o, i) => ({ rank: i + 1, title: o.title, canonUrl: o.canonUrl }));
}
// Pool for the semantic check: ranked stories, topped up with the next freshest unranked ones (so repeats can be replaced).
const pool = [...ordered];
for (const f of base.fresh) { if (pool.length >= 15) break; if (!pool.some(p => p.canonUrl === f.canonUrl)) pool.push(f); }
pool.splice(15);
if (!pool.length) throw new Error('No candidates left for slot ' + cfg.slot);
Object.keys(history.rankings).sort().slice(0, -14).forEach(k => delete history.rankings[k]);

const posted = base.postedCompact.map((p, i) => `P${i + 1}. [${p.date}${p.outlet ? ' ' + p.outlet : ''}] ${p.title}${p.summary && p.src !== 'instagram' ? ' - ' + p.summary : ''}`).join('\n');
const cands = pool.map((c, i) => `C${i + 1}. ${c.title} (${c.source})${c.desc ? ' - ' + c.desc.slice(0, 200) : ''}`).join('\n');
const sameEventPrompt = `You are a strict duplicate detector for an AI news account that must NEVER post the same news twice.
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
return [{ json: { pool, history, sameEventPrompt } }];
