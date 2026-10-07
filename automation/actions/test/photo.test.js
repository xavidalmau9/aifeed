const { test } = require('node:test');
const assert = require('node:assert/strict');
const { photoUrl, probePhoto } = require('../lib/articles');
const { runQuality } = require('../lib/quality');
const { srcHasHedge } = require('../lib/captions');

function fakeFetch({ status = 200, type = 'image/jpeg', bytes = 50000 } = {}) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => type },
    arrayBuffer: async () => new ArrayBuffer(bytes)
  });
}

test('og:image entities are decoded and relative paths resolve against the article', () => {
  assert.equal(photoUrl('https://cdn.example.com/a.jpg?w=1200&amp;q=90', 'https://example.com/story'), 'https://cdn.example.com/a.jpg?w=1200&q=90');
  assert.equal(photoUrl('/img/lead.jpg', 'https://example.com/news/story'), 'https://example.com/img/lead.jpg');
  assert.equal(photoUrl('', 'https://example.com/story'), '');
});

test('photo probe rejects missing, broken, non-image, tiny, and placeholder images', async () => {
  assert.equal((await probePhoto('', fakeFetch())).ok, false);
  assert.equal((await probePhoto('https://cdn.example.com/a.jpg', fakeFetch({ status: 403 }))).ok, false);
  assert.equal((await probePhoto('https://cdn.example.com/a.jpg', fakeFetch({ type: 'text/html' }))).ok, false);
  assert.equal((await probePhoto('https://cdn.example.com/a.jpg', fakeFetch({ bytes: 2000 }))).ok, false);
  assert.equal((await probePhoto('https://cdn.example.com/og-default.png', fakeFetch())).ok, false);
  assert.equal((await probePhoto('https://cdn.example.com/openai-logo-on-phone.jpg', fakeFetch())).ok, true);
  assert.equal((await probePhoto('https://cdn.example.com/lead.jpg', fakeFetch())).ok, true);
});

test('a candidate without a usable photo falls through to the next candidate', () => {
  const words = (n, w) => Array.from({ length: n }, (_, i) => w + i).join(' ');
  const gen = i => ({
    candidate: i, supported: true, safe: true, outlet: 'WIRED',
    igHook: '🚀 Example hook about a launch', igParagraphs: [words(22, 'a'), words(22, 'b'), words(22, 'c')],
    liHook: 'x', liParagraphs: [words(50, 'l')], liTakeaway: 'y',
    igHashtags: ['A', 'B', 'C', 'D', 'E'], liHashtags: ['A', 'B', 'C', 'D', 'E'],
    graphicHeadline: 'EXAMPLE COMPANY SHIPS NEW MODEL', highlightWords: 2,
    summary: 'Example company shipped a new model today for developers.', category: 'MODELS'
  });
  const cand = (n, photoOk) => ({ title: 'Example story ' + n, link: 'https://example.com/' + n, desc: '', text: '', ogImage: photoOk ? 'https://example.com/p.jpg' : '', photoOk, photoProblem: photoOk ? '' : 'no og:image', siteName: 'WIRED', source: 'example.com' });
  const qc = runQuality({ usable: [cand(0, false), cand(1, true)], captionText: JSON.stringify([gen(0), gen(1)]) });
  assert.equal(qc.story.title, 'Example story 1');
  assert.match(qc.failures[0], /photo: no og:image/);
});

test('intent words in the source title count as hedges', () => {
  assert.equal(srcHasHedge({ title: 'The Pentagon Hopes to Speed Up Kill Chain AI Buys' }), true);
  assert.equal(srcHasHedge({ title: 'Meta wants to put AI in every ad' }), true);
  assert.equal(srcHasHedge({ title: 'OpenAI releases 722 math papers' }), false);
  assert.equal(srcHasHedge({ title: 'DeepSeek Considers Doubling Its Funding Round' }), true);
  assert.equal(srcHasHedge({ title: 'OpenAI May Release a New Model Next Week' }), true);
  assert.equal(srcHasHedge({ title: 'Google Shipped Gemini 3 in May' }), false);
  assert.equal(srcHasHedge({ title: 'Google Ships Gemini Update on May 5' }), false);
});
