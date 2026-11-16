const test = require('node:test');
const assert = require('node:assert');
const { topicAdjust, applyTopicMix } = require('../lib/topics');
const { orderPool } = require('../lib/pick');

test('boosts chips, China, spy, security, protest and AI-gone-wrong; demotes stat-only headlines', () => {
  assert.ok(topicAdjust({ title: 'China reportedly recruited AI exec to spy on Jensen Huang' }).adj >= 20);
  assert.strictEqual(topicAdjust({ title: 'The US let Nvidia sell chips to an empty office' }).adj, 15);
  assert.strictEqual(topicAdjust({ title: 'Protesters break into data center site' }).adj, 15);
  assert.strictEqual(topicAdjust({ title: 'Rogue agent wiped a startup database' }).adj, 15);
  assert.strictEqual(topicAdjust({ title: 'AI risks are the biggest threat to the financial system, Fed survey finds' }).adj, -20);
  assert.strictEqual(topicAdjust({ title: '87% of workers now use AI weekly' }).adj, -20);
  assert.strictEqual(topicAdjust({ title: 'Study finds 40% of hacks now use AI' }).adj, 15); // a boosted topic is never demoted
  assert.strictEqual(topicAdjust({ title: 'Google opens a hackathon for chipotle fans' }).adj, 0);
  assert.strictEqual(topicAdjust({ title: 'World models will soon be inescapable' }).adj, 0);
  assert.ok(topicAdjust({ title: 'a', desc: 'b' }).adj <= 25);
});

test('applyTopicMix re-orders by score + nudge, stable on ties', () => {
  const fresh = [
    { title: 'Fed survey finds 87% fear AI' },
    { title: 'New model launch' },
    { title: 'Nvidia chips smuggled to China' }
  ];
  const ranked = [{ index: 1, score: 90 }, { index: 2, score: 80 }, { index: 3, score: 75 }];
  assert.deepStrictEqual(applyTopicMix(ranked, fresh).map(r => r.index), [3, 2, 1]);
  assert.deepStrictEqual(applyTopicMix([{ index: 2, score: 50 }, { index: 2, score: 50 }], fresh).map(r => r.index), [2, 2]);
  assert.deepStrictEqual(applyTopicMix([], fresh), []);
});

test('orderPool uses the topic mix for slot 1 rankings', () => {
  const fresh = [
    { title: 'Poll: 60% of Americans distrust AI', canonUrl: 'u1' },
    { title: 'Hackers breach AI startup', canonUrl: 'u2' }
  ];
  const out = orderPool({ slot: 1, today: '2026-11-17', fresh, history: { posted: [], rankings: {} },
    rankText: '[{"index":1,"score":80},{"index":2,"score":70}]' });
  assert.deepStrictEqual(out.pool.map(p => p.canonUrl), ['u2', 'u1']);
  assert.strictEqual(out.rankings['2026-11-17'][0].canonUrl, 'u2');
  const noRank = orderPool({ slot: 1, today: '2026-11-17', fresh, history: { posted: [], rankings: {} }, rankText: 'garbage' });
  assert.deepStrictEqual(noRank.pool.map(p => p.canonUrl), ['u2', 'u1']);
});
