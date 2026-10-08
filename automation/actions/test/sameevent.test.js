// Same-event check: false positives get a single-pair confirm; real cross-outlet repeats are still caught.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSameEventPrompt, classifySameEvent, finalizeSameEvent, sharedEntities, parseConfirm, seAmounts } = require('../lib/sameevent');
const { applySameEvent } = require('../lib/pick');

// Real posted history (aifeed.run, newest first), as buildPostedCompact formats it.
const COMPACT = [
  { src: 'site', date: '2026-10-08', outlet: 'theverge.com', title: 'Microsoft is giving Copilot more control over Windows and your files', summary: "Microsoft's upgraded Copilot will access local PC files and execute OS actions via Hybrid Intelligence." },
  { src: 'site', date: '2026-10-07', outlet: 'theverge.com', title: 'OpenAI drops another batch of mathematical breakthroughs', summary: 'OpenAI released 722 manuscripts with solutions to hundreds of long-standing mathematics problems from an unreleased frontier model.' },
  { src: 'site', date: '2026-10-06', outlet: '9to5google.com', title: 'ChatGPT Is Now Putting Ads in Your Chats', summary: "OpenAI has started rolling out ads to ChatGPT's free users, a pivotal shift in its business model." },
  { src: 'site', date: '2026-10-05', outlet: 'fortune.com', title: "Sam Altman: 'The World Should Accept Some Bad Things' for AI", summary: 'OpenAI CEO Sam Altman says society should tolerate some harm for AI benefits.' },
  { src: 'site', date: '2026-09-29', outlet: 'theverge.com', title: 'AMD Buys World Labs for Over $8 Billion to Chase Nvidia in AI', summary: "AMD is acquiring World Labs for over $8 billion, a massive bet to challenge Nvidia's dominance in AI chips." },
  { src: 'site', date: '2026-09-10', outlet: 'wired.com', title: 'NASA and IBM Build an AI Model Made for the Moon', summary: 'NASA and IBM built an AI foundation model trained on lunar data.' }
];
const P = title => 'P' + (COMPACT.findIndex(p => p.title === title) + 1);
const AMD = COMPACT[4].title, NASA = COMPACT[5].title, MATH = COMPACT[1].title, ADS = COMPACT[2].title;

const SYNTH1 = { title: 'Google rolls out improved SynthID AI content detector, now available globally', source: 'theverge.com', desc: 'Google is expanding SynthID Detector to everyone, letting anyone check whether images, video, audio or text were made with Google AI.' };
const SYNTH2 = { title: 'Google\u2019s SynthID AI content detector expands globally, will work on Apple\u2019s models \u2018soon\u2019', source: '9to5google.com', desc: 'SynthID watermark detection is now available worldwide.' };
const ADS_REWRITE = { title: 'OpenAI begins showing advertisements to free-tier users', source: 'cnbc.com', desc: 'Free users of the chatbot will now see sponsored placements.' };
const AMD_REWRITE = { title: "Chipmaker AMD agrees to acquire Fei-Fei Li's World Labs in $8B+ deal", source: 'reuters.com', desc: 'The deal values the spatial-intelligence startup at more than $8 billion.' };
const WIRED_MATH = { title: 'OpenAI Is Pissing Off a Bunch of Mathematicians\u2014Again', source: 'wired.com', desc: 'Mathematicians push back on how OpenAI presented its latest batch of AI-generated proofs.' };
const GEMINI_AGENT = { title: "Google Cloud announces 'Gemini agent' as 'universal agent for work'", source: '9to5google.com', desc: 'A single agent for enterprise work.' };

const v = (c, repeat, match, extra) => Object.assign({ c, repeat, match: match || null, why: 'test' }, extra || {});
const CONFIRM_NO = '{"same": false, "entity": null, "event": null, "why": "different companies and announcements"}';
const CONFIRM_YES = '{"same": true, "entity": "OpenAI", "event": "ads in ChatGPT", "why": "same rollout"}';

test('prompt asks for match, matchTitle, entity and event, and forbids candidate-vs-candidate matches', () => {
  const p = buildSameEventPrompt([SYNTH1, SYNTH2], COMPACT);
  assert.match(p, /"matchTitle"/);
  assert.match(p, /"entity"/);
  assert.match(p, /"event"/);
  assert.match(p, /Never compare candidates with each other/);
  assert.match(p, /unsure[\s\S]*repeat=true/);
  assert.match(p, /P5\. \[2026-09-29 theverge\.com\] AMD Buys World Labs/);
});

test('Google SynthID flagged as a repeat of AMD/World Labs and NASA/IBM: pair confirm says different -> both stay new', () => {
  const pool = [SYNTH1, SYNTH2, GEMINI_AGENT];
  // What the model answered on Oct 8 (it matched the two SynthID stories to each other, citing unrelated P items).
  const text = JSON.stringify([
    v(1, true, P(NASA), { entity: 'Google', event: 'SynthID global rollout' }),
    v(2, true, P(AMD), { matchTitle: AMD, entity: 'Google', event: 'SynthID global rollout' }),
    v(3, false)
  ]);
  const cls = classifySameEvent(pool, COMPACT, text);
  assert.equal(cls[0].status, 'confirm');
  assert.equal(cls[0].matched, NASA);
  assert.equal(cls[1].status, 'confirm');
  assert.equal(cls[1].matched, AMD);
  assert.deepEqual(sharedEntities(SYNTH2, COMPACT[4], 'Google'), []);
  assert.match(cls[1].prompt, /CANDIDATE: Google.s SynthID[\s\S]*ALREADY POSTED: \[2026-09-29 theverge\.com\] AMD Buys World Labs/);
  assert.doesNotMatch(cls[1].prompt, /NASA and IBM|Putting Ads|Copilot more control|mathematical breakthroughs/, 'confirm prompt carries just that single pair');
  const out = finalizeSameEvent(pool, cls, { 0: CONFIRM_NO, 1: CONFIRM_NO });
  assert.deepEqual(out.candidates.map(c => c.title), [SYNTH1.title, SYNTH2.title, GEMINI_AGENT.title]);
  assert.equal(out.sameEventSkipped.length, 0);
  assert.equal(out.sameEventOverturned.length, 2);
});

test('the pair confirm keeps "unsure"/same as a repeat, and an unreadable confirm stops the run', () => {
  const pool = [SYNTH2, GEMINI_AGENT];
  const text = JSON.stringify([v(1, true, P(AMD)), v(2, false)]);
  const yes = applySameEvent(pool, COMPACT, text, { 0: '{"same": true, "why": "unsure"}' });
  assert.deepEqual(yes.candidates.map(c => c.title), [GEMINI_AGENT.title]);
  assert.match(yes.sameEventSkipped[0].reason, /confirmed same event/);
  assert.throws(() => applySameEvent(pool, COMPACT, text, { 0: 'I think they differ' }), /no readable verdict/);
  assert.throws(() => applySameEvent(pool, COMPACT, text, {}), /no readable verdict/);
  assert.equal(parseConfirm('{"same": "maybe"}'), null);
});

test("yesterday's real cross-outlet repeats are still caught without a confirm call", () => {
  const pool = [ADS_REWRITE, AMD_REWRITE, WIRED_MATH, GEMINI_AGENT];
  const text = JSON.stringify([
    v(1, true, P(ADS), { matchTitle: ADS, entity: 'OpenAI', event: 'ads for free ChatGPT users' }),
    v(2, true, P(AMD), { matchTitle: AMD, entity: 'AMD', event: 'AMD acquires World Labs' }),
    v(3, true, P(MATH), { matchTitle: MATH, entity: 'OpenAI', event: 'OpenAI math results' }),
    v(4, false)
  ]);
  const cls = classifySameEvent(pool, COMPACT, text);
  assert.deepEqual(cls.map(r => r.status), ['repeat', 'repeat', 'repeat', 'new']);
  assert.ok(cls[0].shared.includes('openai'), 'ChatGPT counts as OpenAI');
  assert.ok(cls[1].shared.includes('amd') && cls[1].shared.includes('labs'));
  assert.ok(cls[2].shared.includes('openai'));
  const out = finalizeSameEvent(pool, cls, {});
  assert.deepEqual(out.candidates.map(c => c.title), [GEMINI_AGENT.title]);
  assert.deepEqual(out.sameEventSkipped.map(s => s.matched), [ADS, AMD, MATH]);
});

test('repeats are still caught when the model gets the P number wrong', () => {
  // Wrong number but the copied title is right -> resolved by title, no confirm needed.
  const a = classifySameEvent([AMD_REWRITE], COMPACT, JSON.stringify([v(1, true, 'P1', { matchTitle: AMD })]));
  assert.equal(a[0].status, 'repeat');
  assert.equal(a[0].matched, AMD);
  // Number outside the history and no title -> confirm against the closest posted item (shares OpenAI).
  const b = classifySameEvent([WIRED_MATH], COMPACT, JSON.stringify([v(1, true, 'P99')]));
  assert.equal(b[0].status, 'confirm');
  assert.ok([MATH, ADS, COMPACT[3].title].includes(b[0].matched));
  assert.equal(finalizeSameEvent([WIRED_MATH, GEMINI_AGENT], [b[0], { i: 1, status: 'new' }], { 0: CONFIRM_YES }).sameEventSkipped.length, 1);
});

test('a missing verdict is a repeat and an unreadable first answer stops the run', () => {
  const pool = [SYNTH1, GEMINI_AGENT];
  const out = applySameEvent(pool, COMPACT, JSON.stringify([v(2, false)]));
  assert.deepEqual(out.candidates.map(c => c.title), [GEMINI_AGENT.title]);
  assert.match(out.sameEventSkipped[0].reason, /no verdict/);
  assert.throws(() => applySameEvent(pool, COMPACT, 'no json here'), /no readable verdict/);
  assert.throws(() => applySameEvent([SYNTH1], COMPACT, JSON.stringify([v(1, true, P(ADS), { matchTitle: ADS, entity: 'Google' })]), { 0: CONFIRM_YES }), /All 1 candidate stories were already posted/);
});

test('the same big money amount counts as a shared key (story that never names the company)', () => {
  assert.deepEqual([...seAmounts('AMD Buys World Labs for Over $8 Billion')], ['$8000m']);
  assert.deepEqual([...seAmounts("in $8B+ deal")], ['$8000m']);
  assert.deepEqual([...seAmounts('raises $14.9 billion; 5m users; $50 million seed')], ['$14900m']);
  const F = { title: "Fei-Fei Li's spatial intelligence startup sold to chipmaker in $8 billion deal", source: 'ft.com' };
  const cls = classifySameEvent([F], COMPACT, JSON.stringify([v(1, true, P(AMD), { matchTitle: AMD })]));
  assert.equal(cls[0].status, 'repeat');
  assert.deepEqual(cls[0].shared, ['$8000m']);
  // SynthID has no amount and no shared word -> still goes to the pair confirm
  assert.equal(classifySameEvent([SYNTH2], COMPACT, JSON.stringify([v(1, true, P(AMD))]))[0].status, 'confirm');
});
