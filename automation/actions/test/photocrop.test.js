const test = require('node:test');
const assert = require('node:assert');
const { tallerVariant } = require('../lib/photos');
const { buildGraphics } = require('../lib/html');

test('wide Condé Nast crop is swapped for the square crop of the same photo', () => {
  const og = 'https://media.wired.com/photos/6ac81c8de30ca6995f7d2b30/191:100/w_1280,c_limit/Publishers.jpg';
  assert.strictEqual(tallerVariant(og), 'https://media.wired.com/photos/6ac81c8de30ca6995f7d2b30/1:1/w_1600,c_limit/Publishers.jpg');
  assert.strictEqual(tallerVariant('https://media.wired.com/photos/6ac81c8de30ca6995f7d2b30/4:5/w_1280,c_limit/x.jpg'), '');
  assert.strictEqual(tallerVariant('https://cdn.example.com/a/191:100/b.jpg'), '');
});

test('feed photo sits above the text block with a raised focal point', () => {
  const { html, storyHtml } = buildGraphics({ imageUrl: 'https://x.test/p.jpg', graphicHeadline: 'A B C', highlightWords: 1, summary: 's', category: 'AI', siteName: 'X', source: 'x.test' });
  assert.match(html, /\.photo\{[^}]*height:1000px[^}]*center 18%\/cover/);
  assert.match(storyHtml, /\.photo\{[^}]*top:80px[^}]*center 18%\/cover/);
});
