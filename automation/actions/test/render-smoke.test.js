const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { buildGraphics } = require('../lib/html');
const { pngSize } = require('../lib/png');
const { renderHtml, closeBrowser } = require('../render');

after(async () => { await closeBrowser(); });

test('renderer produces 1080x1350 and 1080x1920 PNGs from the workflow HTML', { timeout: 120000 }, async () => {
  const graphics = buildGraphics({
    imageUrl: '',
    graphicHeadline: 'DEEPSEEK WEIGHS DOUBLING ROUND TO $15B',
    highlightWords: 3,
    summary: 'DeepSeek considers expanding its funding round to up to $15 billion, double its earlier target.',
    category: 'BUSINESS',
    siteName: 'CNBC',
    source: 'cnbc.com'
  });
  assert.match(graphics.html, /AIFEED\.RUN/);
  assert.match(graphics.html, /DEEPSEEK/);
  assert.match(graphics.storyHtml, /NEW POST/);
  assert.match(graphics.html, /window\.__fitReport/);

  const feed = await renderHtml(graphics.html, { width: 1080, height: 1350, waitMs: 3000 });
  const story = await renderHtml(graphics.storyHtml, { width: 1080, height: 1920, waitMs: 3000 });
  assert.deepEqual(pngSize(feed.png), { width: 1080, height: 1350 });
  assert.deepEqual(pngSize(story.png), { width: 1080, height: 1920 });
  assert.equal(feed.fit.ok, true, 'feed text-fit failed: ' + JSON.stringify(feed.fit));
  assert.equal(story.fit.ok, true, 'story text-fit failed: ' + JSON.stringify(story.fit));
  assert.ok(feed.png.length > 10000);
  assert.ok(story.png.length > 10000);
});
