const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  fcSplitSentences, fcItems, buildFactPrompt, applyFactVerdicts, sourceCheckCandidate, sourceCheckAll, checkLiExpansion
} = require('../lib/factcheck');
const { runQuality } = require('../lib/quality');
const { checkIg } = require('../lib/captions');

const { INVENTED, source, gen, fakeAsk } = require('./fixtures-factcheck');

test('sentence splitter keeps abbreviations and money together', () => {
  assert.deepEqual(fcSplitSentences('The U.S. Army spent $1.5 trillion. Then it stopped! "Really?" Yes.'), ['The U.S. Army spent $1.5 trillion.', 'Then it stopped!', '"Really?"', 'Yes.']);
});

test('every published sentence is sent: headline, summary, hook, IG sentences, LinkedIn copy', () => {
  const g = gen(0, INVENTED);
  const ids = fcItems(g).map(i => i.id);
  assert.deepEqual(ids.slice(0, 3), ['H', 'S', 'K']);
  assert.ok(ids.includes('P1.2') && ids.includes('P4.2') && ids.includes('L2.1') && ids.includes('LH') && ids.includes('LT'));
  const prompt = buildFactPrompt(source(0), g);
  assert.match(prompt, /ARTICLE TEXT \(truncated\): At its Windows and Surface event/);
  assert.match(prompt, /P4\.2: The update is rolling out to all users/);
  const noText = buildFactPrompt(Object.assign(source(0), { text: '' }), g);
  assert.match(noText, /FEED DESCRIPTION: Microsoft showed off/);
});

test('an invented body sentence ("rolling out to all users") is caught and dropped; layout still passes', async () => {
  const c = source(0);
  const g = gen(0, INVENTED);
  const r = await sourceCheckCandidate({ c, g, ask: fakeAsk({ bad: ['rolling out to all users'] }) });
  assert.equal(r.status, 'patched');
  assert.deepEqual(r.changes, ['dropped P4.2']);
  assert.ok(!g.igParagraphs.join(' ').includes('rolling out'));
  const qc = runQuality({ usable: [c], gen: [g] });
  assert.equal(qc.story.title, c.title);
  assert.ok(!qc.gen.igCaption.includes('rolling out'));
  assert.deepEqual(checkIg(qc.gen.igCaption, c.link), []);
  assert.equal((qc.gen.igCaption.match(/^Source: /gm) || []).length, 1);
  assert.equal((qc.gen.igCaption.match(/#[A-Za-z0-9]+/g) || []).length, 5);
});

test('an unsupported sentence is rewritten from the source when dropping it would leave the caption too thin, then verified again', async () => {
  const c = source(0);
  const g = gen(0, INVENTED);
  g.igParagraphs = [
    'Microsoft showed off an upgrade to Copilot at its Windows and Surface event with access to local files.',
    'It is part of what Microsoft calls Hybrid Intelligence, mixing local and cloud AI models.',
    'Jacob Andreou demoed Autopilot helping with filing taxes.',
    'The new search arrives this fall on Windows 11 PCs. ' + INVENTED
  ];
  const calls = [];
  const ask = fakeAsk({ bad: ['rolling out to all users'], rewrites: { 'rolling out to all users': 'Microsoft says it arrives this fall on Windows 11 PCs.' }, calls });
  const r = await sourceCheckCandidate({ c, g, ask });
  assert.equal(r.status, 'patched');
  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls[1], /"rewrite"/);
  assert.match(g.igParagraphs[3], /Microsoft says it arrives this fall on Windows 11 PCs\.$/);
  assert.deepEqual(r.changes, ['rewrote P4.2']);
});

test('still unsupported after the one rewrite -> candidate fails', async () => {
  const c = source(0);
  const g = gen(0, INVENTED);
  g.igParagraphs = g.igParagraphs.map(p => p.split('. ')[0].replace(/\.?$/, '.'));
  g.igParagraphs[3] = INVENTED;
  const ask = fakeAsk({ bad: ['rolling out to all users', 'everyone'], rewrites: { 'rolling out to all users': 'It is now available to everyone.' } });
  const r = await sourceCheckCandidate({ c, g, ask });
  assert.equal(r.status, 'fail');
  assert.equal(g.supported, false);
  assert.match(g.issues, /still unsupported/);
});

test('unsupported headline, summary or hook with no rewrite fails the candidate (they cannot be dropped)', () => {
  const g = gen(0);
  const items = fcItems(g);
  const text = JSON.stringify(items.map(i => ({ id: i.id, supported: i.id !== 'K', why: 'x', rewrite: '' })));
  const r = applyFactVerdicts(g, text, { allowRewrite: true });
  assert.equal(r.status, 'fail');
  assert.equal(g.supported, false);
});

test('unreadable or incomplete verdicts fail the candidate', async () => {
  for (const raw of ['', 'I think it is fine.', '[{"id":"H","supported":true}]']) {
    const g = gen(0);
    const r = await sourceCheckCandidate({ c: source(0), g, ask: fakeAsk({ raw }) });
    assert.equal(r.status, 'fail', raw);
    assert.equal(g.supported, false);
  }
  const g = gen(0);
  const r = await sourceCheckCandidate({ c: source(0), g, ask: async () => { throw new Error('HTTP 529'); } });
  assert.equal(r.status, 'fail');
});

test('a failed candidate falls back to the next; none left means nothing is posted', async () => {
  const usable = [source(0), source(1)];
  const ask = async prompt => {
    const lines = prompt.split('ITEMS:\n')[1].split('\n\nReturn ONLY')[0].split('\n');
    const first = prompt.includes(usable[0].title);
    return JSON.stringify(lines.map(l => ({ id: l.slice(0, l.indexOf(':')), supported: !(first && l.startsWith('K:')), why: 'x', rewrite: '' })));
  };
  const out = await sourceCheckAll({ gen: [gen(0), gen(1)], usable, ask });
  assert.deepEqual(out.log.map(l => l.status), ['fail', 'pass']);
  const qc = runQuality({ usable, gen: out.gen });
  assert.equal(qc.story.title, usable[1].title);
  assert.match(qc.failures[0], /source check/);

  const none = await sourceCheckAll({ gen: [gen(0), gen(1)], usable, ask: fakeAsk({ raw: 'nope' }) });
  assert.throws(() => runQuality({ usable, gen: none.gen }), /No candidate passed quality checks/);
});

test('dropping sentences that leaves too little caption falls back instead of posting a thin caption', async () => {
  const c = source(0);
  const g = gen(0);
  const r = await sourceCheckCandidate({ c, g, ask: fakeAsk({ bad: ['Hybrid Intelligence idea', 'Andreou', 'Windows search'] }) });
  assert.equal(r.status, 'patched');
  assert.throws(() => runQuality({ usable: [c], gen: [g] }), /IG layout: block count/);
});

test('LinkedIn expansion (website body) with an invented claim is rejected; the checked original is kept', async () => {
  const expanded = JSON.stringify({ liHook: 'Copilot can now reach into your files.', liParagraphs: ['Microsoft showed a Copilot upgrade with local file access.', INVENTED], liTakeaway: 'Big change.' });
  const bad = await checkLiExpansion({ c: source(0), gen: gen(0), expandedText: expanded, ask: fakeAsk({ bad: ['rolling out to all users'] }) });
  assert.equal(bad.ok, false);
  const good = await checkLiExpansion({ c: source(0), gen: gen(0), expandedText: expanded, ask: fakeAsk({}) });
  assert.equal(good.ok, true);
  const unreadable = await checkLiExpansion({ c: source(0), gen: gen(0), expandedText: 'nope', ask: fakeAsk({}) });
  assert.equal(unreadable.ok, false);
});
