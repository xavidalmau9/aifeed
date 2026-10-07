const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canonUrl, cheapRepeat, igHistory, DEFAULT_REPEAT } = require('../lib/dedup');
const { selectFresh } = require('../lib/rss');
const { applySameEvent } = require('../lib/pick');

test('URL canon drops scheme, www/m/amp, tracking, trailing slash, and /amp', () => {
  assert.equal(canonUrl('https://www.TheVerge.com/ai/foo/?utm_source=x'), 'theverge.com/ai/foo');
  assert.equal(canonUrl('https://m.theverge.com/ai/foo/'), 'theverge.com/ai/foo');
  assert.equal(canonUrl('https://amp.example.com/story/amp'), 'example.com/story');
  assert.equal(canonUrl('https://example.com/a/index.html'), 'example.com/a');
  assert.equal(canonUrl('https://example.com/watch?v=abc&utm_campaign=1'), 'example.com/watch?v=abc');
  assert.equal(DEFAULT_REPEAT.jaccard, 0.6);
});

test('same normalized source URL is a repeat even from another link shape', () => {
  const hist = [{
    src: 'site',
    title: 'Unrelated headline about a different topic entirely',
    canon: 'theverge.com/ai/foo',
    url: 'https://www.theverge.com/ai/foo',
    date: '2026-01-01'
  }];
  const rep = cheapRepeat({
    title: 'A totally different string of words about gardening tools',
    link: 'https://m.theverge.com/ai/foo/?utm_source=ig'
  }, hist);
  assert.equal(rep.reason, 'same source URL');
});

test('similar headlines match and unrelated headlines do not', () => {
  const hist = [{
    src: 'site',
    title: 'OpenAI drops another batch of mathematical breakthroughs',
    canon: 'theverge.com/ai/openai-math',
    url: 'https://www.theverge.com/ai/openai-math',
    date: '2026-10-07'
  }];
  const sim = cheapRepeat({
    title: 'OpenAI drops another batch of mathematical breakthroughs',
    link: 'https://www.wired.com/story/openai-math-different-url'
  }, hist);
  assert.match(sim.reason, /similar title/);
  const fresh = cheapRepeat({
    title: 'Nvidia announces a brand new chip for weather balloons',
    link: 'https://www.wired.com/nvidia-weather-balloons-chip'
  }, hist);
  assert.equal(fresh, null);
});

test('batch dedup drops a story already on the site and a duplicate inside the batch', () => {
  const hist = [{ src: 'site', title: 'Old story', canon: 'cnbc.com/a', url: 'https://www.cnbc.com/a', date: '2026-09-01' }];
  const items = [
    { title: 'Nvidia announces a brand new chip for weather balloons', link: 'https://www.cnbc.com/a?utm_source=rss', source: 'cnbc.com' },
    { title: 'Robot cooks open a downtown cafe in Austin this week', link: 'https://www.theverge.com/robot-cooks-austin-cafe', source: 'theverge.com' },
    { title: 'Robot cooks open a downtown cafe in Austin this week', link: 'https://www.wired.com/robot-cooks-austin-cafe-again', source: 'wired.com' }
  ];
  const { fresh, skipped } = selectFresh(items, hist);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].reason, 'same source URL');
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].canonUrl, 'theverge.com/robot-cooks-austin-cafe');
});

test('Instagram history uses the source URL and ignores aifeed.run links', () => {
  const ig = igHistory([{
    caption: '🔥 A hook about chips\n⠀\nBody of the caption here.\n⠀\nSource: CNBC · https://www.cnbc.com/full/url/\n⠀\nhttps://aifeed.run/images/x.png',
    timestamp: '2026-10-01T12:00:00Z'
  }]);
  assert.equal(ig[0].url, 'https://www.cnbc.com/full/url/');
  assert.equal(ig[0].canon, 'cnbc.com/full/url');
  assert.equal(ig[0].src, 'instagram');
});

test('same-event check drops repeats, treats a missing verdict as a repeat, and stops when unreadable', () => {
  const pool = [
    { title: 'Outlet B rewrites the funding story', source: 'wired.com' },
    { title: 'A different product launch from another company', source: 'theverge.com' },
    { title: 'No verdict for this one at all today', source: 'cnbc.com' }
  ];
  const compact = [{ title: 'Company raises a huge round', src: 'site' }];
  const text = JSON.stringify([
    { c: 1, repeat: true, match: 'P1', why: 'same funding round' },
    { c: 2, repeat: false, match: null, why: 'different announcement' }
  ]);
  const out = applySameEvent(pool, compact, text);
  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0].title, pool[1].title);
  assert.equal(out.sameEventSkipped.length, 2);
  assert.match(out.sameEventSkipped[1].reason, /no verdict/);
  assert.throws(() => applySameEvent(pool, compact, 'not json'), /no readable verdict/);
});
