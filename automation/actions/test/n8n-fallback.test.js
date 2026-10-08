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

test('n8n Facebook branch: enabled, after IG Publish, same caption as Actions (buildFb), failures only alert', () => {
  const { buildFb, SPACER } = require('../lib/captions');
  const cfg = NODES['Config'].parameters.jsonOutput;
  const actionsCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../config.json'), 'utf8'));
  assert.equal(/"fbEnabled": true/.test(cfg), actionsCfg.fbEnabled === true);
  assert.ok(next('IG Publish').includes('Facebook Enabled?'));
  assert.deepEqual(next('Facebook Enabled?'), ['FB Upload Photo 1']);
  for (const n of ['FB Upload Photo 1', 'FB Upload Photo 2', 'FB Create Post']) {
    assert.equal(NODES[n].onError, 'continueErrorOutput', n + ' must route errors to the alert');
    assert.deepEqual((WF.connections[n].main[1] || []).map(c => c.node), ['FB Failed Alert']);
    assert.equal(NODES[n].credentials.httpQueryAuth.id, 'aifeedMetaIG0001');
  }
  const expr = NODES['FB Create Post'].parameters.bodyParameters.parameters.find(p => p.name === 'message').value;
  const m = expr.match(/^=\{\{ \$\('Validate PNG \+ Prep Commits'\)\.first\(\)\.json\.igCaption(\.replace\(.*\)) \}\}$/);
  assert.ok(m, 'FB message expression shape changed');
  const ig = ['🔥 Hook', 'Para one.', 'Para two.', 'Para three.', 'Source: The Verge · https://www.theverge.com/x',
    '📩 Free weekly AI brief → link in bio', '#A #B #C #D #E'].join('\n' + SPACER + '\n');
  const igCaption = ig;
  const out = eval('igCaption' + m[1]);
  assert.equal(out, buildFb(ig));
});

// ---- same-event check (automation/n8n/sync_same_event.py inlines lib/sameevent.js) ----
const SE_SRC = fs.readFileSync(path.join(__dirname, '../lib/sameevent.js'), 'utf8');
const SE_LIB = SE_SRC.slice(0, SE_SRC.indexOf('// ---- end of shared same-event code ----')).trimEnd();

test('n8n same-event nodes carry the current lib/sameevent.js (run sync_same_event.py after editing it) and are wired in order', () => {
  for (const n of ['Pick Slot Story', 'Same-Event Verify', 'Drop Same-Event Repeats']) {
    assert.ok(code(n).includes(SE_LIB), n + ' is out of date with lib/sameevent.js');
  }
  assert.match(code('Pick Slot Story'), /buildSameEventPrompt\(pool, base\.postedCompact\)/);
  assert.deepEqual(next('Pick Slot Story'), ['Claude Same-Event Check']);
  assert.deepEqual(next('Claude Same-Event Check'), ['Same-Event Verify']);
  assert.deepEqual(next('Same-Event Verify'), ['Claude Same-Event Confirm']);
  assert.deepEqual(next('Claude Same-Event Confirm'), ['Drop Same-Event Repeats']);
  assert.deepEqual(next('Drop Same-Event Repeats'), ['Fetch Articles']);
  const c = NODES['Claude Same-Event Confirm'];
  assert.equal(c.credentials.httpHeaderAuth.id, 'aifeedAnthrop001');
  assert.equal(c.onError, 'continueRegularOutput'); // API error = unreadable confirm = run stops in Drop
  assert.match(c.parameters.jsonBody, /temperature: 0/);
  assert.match(c.parameters.jsonBody, /\$json\.prompt/);
});

test('n8n same-event nodes: SynthID false positive overturned by the pair confirm, real repeat kept out', async () => {
  const compact = [
    { src: 'site', date: '2026-10-06', outlet: '9to5google.com', title: 'ChatGPT Is Now Putting Ads in Your Chats', summary: 'OpenAI has started rolling out ads to free users.' },
    { src: 'site', date: '2026-09-29', outlet: 'theverge.com', title: 'AMD Buys World Labs for Over $8 Billion to Chase Nvidia in AI', summary: 'AMD is acquiring World Labs.' }
  ];
  const fresh = [
    { title: 'Google rolls out improved SynthID AI content detector, now available globally', source: 'theverge.com', canonUrl: 'a' },
    { title: 'OpenAI begins showing advertisements to free-tier users', source: 'cnbc.com', canonUrl: 'b' },
    { title: 'Manus raises $500 million', source: 'techcrunch.com', canonUrl: 'c' }
  ];
  const out = {
    Config: [{ slot: 1, today: '2026-10-08' }],
    'Fetch RSS + Dedup': [{ fresh, history: { posted: [], rankings: {} }, postedCompact: compact }]
  };
  out['Pick Slot Story'] = await runNode('Pick Slot Story', out, [{ content: [{ text: '[{"index":1},{"index":2},{"index":3}]' }] }]);
  assert.match(out['Pick Slot Story'][0].sameEventPrompt, /Never compare candidates with each other/);
  out['Claude Same-Event Check'] = [{ content: [{ type: 'text', text: JSON.stringify([
    { c: 1, repeat: true, match: 'P2', matchTitle: compact[1].title, entity: 'Google', event: 'SynthID rollout' },
    { c: 2, repeat: true, match: 'P1', matchTitle: compact[0].title, entity: 'OpenAI', event: 'ChatGPT ads' },
    { c: 3, repeat: false, match: null }
  ]) }] }];
  out['Same-Event Verify'] = await runNode('Same-Event Verify', out, out['Claude Same-Event Check']);
  assert.equal(out['Same-Event Verify'].length, 1);
  assert.equal(out['Same-Event Verify'][0].key, 0);
  assert.match(out['Same-Event Verify'][0].prompt, /SynthID[\s\S]*AMD Buys World Labs/);
  const confirm = text => out['Same-Event Verify'].map(() => ({ content: [{ type: 'text', text }] }));
  const r = (await runNode('Drop Same-Event Repeats', out, confirm('{"same": false, "why": "different companies"}')))[0];
  assert.deepEqual(r.candidates.map(c => c.canonUrl), ['a', 'c']);
  assert.deepEqual(r.sameEventSkipped.map(s => s.matched), [compact[0].title]);
  await assert.rejects(runNode('Drop Same-Event Repeats', out, [{ error: { message: 'HTTP 529' } }]), /no readable verdict/);
  // nothing to confirm -> one dummy item keeps the HTTP node fed and is ignored
  out['Claude Same-Event Check'] = [{ content: [{ type: 'text', text: '[{"c":1,"repeat":false},{"c":2,"repeat":true,"match":"P1","matchTitle":"ChatGPT Is Now Putting Ads in Your Chats"},{"c":3,"repeat":false}]' }] }];
  out['Same-Event Verify'] = await runNode('Same-Event Verify', out, out['Claude Same-Event Check']);
  assert.equal(out['Same-Event Verify'][0].key, null);
  const r2 = (await runNode('Drop Same-Event Repeats', out, confirm('[]')))[0];
  assert.deepEqual(r2.candidates.map(c => c.canonUrl), ['a', 'c']);
  await assert.rejects(runNode('Same-Event Verify', out, [{ content: [{ text: 'oops' }] }]), /no readable verdict/);
});
