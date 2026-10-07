// The n8n fallback (automation/n8n/AIFeed_Autopilot.json) inlines the source fact-check library.
// These tests catch drift from lib/factcheck.js and run the new n8n Code nodes with a fake Claude.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { INVENTED, source, gen, fakeAsk } = require('./fixtures-factcheck');
const { checkIg, buildIg } = require('../lib/captions');

const WF = JSON.parse(fs.readFileSync(path.join(__dirname, '../../n8n/AIFeed_Autopilot.json'), 'utf8'));
const NODES = Object.fromEntries(WF.nodes.map(n => [n.name, n]));
const FC = fs.readFileSync(path.join(__dirname, '../lib/factcheck.js'), 'utf8');
const LIB = FC.slice(0, FC.indexOf('// ---- end of shared source-check code ----')).trimEnd();
const next = name => (WF.connections[name]?.main?.[0] || []).map(c => c.node);
const code = name => NODES[name].parameters.jsCode;

test('n8n Code nodes carry the current shared fact-check library (run sync_source_check.py after editing it)', () => {
  for (const n of ['Source Check Prep', 'Source Check Apply', 'Source Recheck Apply', 'Accuracy Recheck Prep', 'Accuracy Recheck Apply', 'LI Expansion Check Prep', 'Merge LI Caption']) {
    assert.ok(code(n).includes(LIB), n + ' is out of date with lib/factcheck.js');
  }
  const art = fs.readFileSync(path.join(__dirname, '../lib/articles.js'), 'utf8');
  const fn = art.match(/function articleText\(html\) \{[\s\S]*?\n\}\n/)[0];
  assert.ok(code('Fetch Articles').includes(fn), 'Fetch Articles articleText() out of date');
  assert.ok(code('Fetch Articles').includes('const text = articleText(html);'));
});

test('n8n wiring: captions -> source check -> recheck -> Quality -> Layout Check; accuracy fix and LI expansion are checked too', () => {
  assert.deepEqual(next('Claude Captions + Fact Check'), ['Source Check Prep']);
  assert.deepEqual(next('Source Check Prep'), ['Claude Source Check']);
  assert.deepEqual(next('Claude Source Check'), ['Source Check Apply']);
  assert.deepEqual(next('Source Check Apply'), ['Claude Source Recheck']);
  assert.deepEqual(next('Claude Source Recheck'), ['Source Recheck Apply']);
  assert.deepEqual(next('Source Recheck Apply'), ['Quality Checks + Build HTML']);
  assert.deepEqual(next('Claude Fix Accuracy'), ['Accuracy Recheck Prep']);
  assert.deepEqual(next('Accuracy Recheck Apply'), ['Quality Checks + Build HTML']);
  assert.deepEqual(next('Claude Expand LinkedIn'), ['LI Expansion Check Prep']);
  assert.deepEqual(next('Claude LI Expansion Check'), ['Merge LI Caption']);
  for (const n of ['Claude Source Check', 'Claude Source Recheck', 'Claude Accuracy Recheck', 'Claude LI Expansion Check']) {
    const p = NODES[n];
    assert.equal(p.credentials.httpHeaderAuth.id, 'aifeedAnthrop001');
    assert.equal(p.onError, 'continueRegularOutput'); // an API error = unreadable verdict = candidate fails
    assert.match(p.parameters.jsonBody, /temperature: 0/);
  }
  assert.match(code('Quality Checks + Build HTML'), /\$\(fixPass \? 'Accuracy Recheck Apply' : 'Source Recheck Apply'\)/);
});

test('n8n fallback schedule is 8:50am and 5:50pm ET', () => {
  const s = WF.nodes.find(n => n.type.endsWith('scheduleTrigger'));
  assert.equal(s.parameters.rule.interval[0].expression, '50 8,17 * * *');
  assert.equal(WF.settings.timezone, 'America/New_York');
});

// Minimal n8n runtime for Code nodes: $('Node').first()/.all(), $input, $runIndex.
async function runNode(name, out, input) {
  const $ = n => {
    if (!out[n]) throw new Error('no output for ' + n);
    return { first: () => ({ json: out[n][0] }), all: () => out[n].map(json => ({ json })) };
  };
  const $input = { first: () => ({ json: input[0] }), all: () => input.map(json => ({ json })) };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const res = await new AsyncFunction('$', '$input', '$runIndex', code(name))($, $input, 0);
  return res.map(r => r.json);
}
// HTTP node stand-in: one Anthropic response per input item.
async function claude(items, ask) {
  return Promise.all(items.map(async it => ({ content: [{ type: 'text', text: it.prompt.includes('ITEMS:') ? await ask(it.prompt) : '[]' }] })));
}

async function runSourceCheck(gens, sources, askFn, askFn2) {
  const out = {
    'Fetch Articles': [{ usable: sources, history: [] }],
    'Claude Captions + Fact Check': [{ content: [{ type: 'text', text: '```json\n' + JSON.stringify(gens) + '\n```' }] }]
  };
  out['Source Check Prep'] = await runNode('Source Check Prep', out, [{}]);
  out['Claude Source Check'] = await claude(out['Source Check Prep'], askFn);
  out['Source Check Apply'] = await runNode('Source Check Apply', out, out['Claude Source Check']);
  out['Claude Source Recheck'] = await claude(out['Source Check Apply'], askFn2 || askFn);
  out['Source Recheck Apply'] = await runNode('Source Recheck Apply', out, out['Claude Source Recheck']);
  return out['Source Recheck Apply'][0];
}

test('n8n nodes: the invented "rolling out to all users" sentence is dropped, other candidates untouched', async () => {
  const calls = [];
  const r = await runSourceCheck([gen(0, INVENTED), gen(1)], [source(0), source(1)], fakeAsk({ bad: ['rolling out to all users'], calls }));
  assert.equal(calls.filter(p => p.includes('ITEMS:')).length, 2); // one check per candidate, no recheck (drop only)
  const g0 = r.gen[0];
  assert.equal(g0.supported, true);
  assert.ok(!JSON.stringify(g0).includes('rolling out to all users'));
  assert.equal(r.sourceCheckLog[0].status, 'patched');
  assert.equal(r.sourceCheckLog[1].status, 'pass');
  const ig = buildIg(g0, source(0).link);
  assert.deepEqual(checkIg(ig, source(0).link), []);
  assert.equal((ig.match(/^Source: /gm) || []).length, 1);
});

test('n8n nodes: unreadable verdict or failed rewrite -> candidate marked unsupported (Quality falls back)', async () => {
  const r1 = await runSourceCheck([gen(0), gen(1)], [source(0), source(1)], fakeAsk({ raw: 'Sorry, I cannot help.' }));
  assert.equal(r1.gen[0].supported, false);
  assert.equal(r1.gen[1].supported, false);
  // headline unsupported: rewritten once, rewrite still unsupported on the recheck -> fail
  const g = gen(0); g.graphicHeadline = 'COPILOT NOW FREE FOR EVERY WINDOWS USER';
  const r2 = await runSourceCheck([g, gen(1)], [source(0), source(1)],
    fakeAsk({ bad: ['FREE FOR EVERY'], rewrites: { 'FREE FOR EVERY': 'COPILOT GETS FREE FILE ACCESS' } }),
    fakeAsk({ bad: ['COPILOT GETS FREE FILE ACCESS'] }));
  assert.equal(r2.gen[0].supported, false);
  assert.match(r2.gen[0].issues, /source check/);
  assert.equal(r2.gen[1].supported, true);
  // all candidates already unsupported: a dummy prompt keeps the HTTP node fed; nothing becomes eligible
  const bad = gen(0); bad.supported = false;
  const r3 = await runSourceCheck([bad], [source(0)], fakeAsk({ raw: '[]' }));
  assert.equal(r3.gen[0].supported, false);
});
