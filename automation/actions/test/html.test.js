const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildGraphics } = require('../lib/html');

test('hyphenated headline words are kept on one line in the feed and story graphics', () => {
  const g = buildGraphics({ imageUrl: 'https://example.com/p.jpg', graphicHeadline: 'PENTAGON PLANS TO SPEED AI BUYS WITH 5-MINUTE VIDEOS', highlightWords: 2, summary: 'A short summary for the test card goes here today.', category: 'POLICY', siteName: 'WIRED', source: 'wired.com' });
  for (const html of [g.html, g.storyHtml]) {
    assert.match(html, /<span class="nw">5-MINUTE<\/span>/);
    assert.match(html, /\.nw\{white-space:nowrap\}/);
  }
  assert.match(g.storyHtml, /S\.style\.background = 'linear-gradient/);
});
