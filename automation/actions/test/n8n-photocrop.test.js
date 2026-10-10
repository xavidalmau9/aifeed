// The n8n fallback inlines the photo-crop fix from lib/photos.js (Oct 10). Runs its Fetch Articles node with fake HTTP.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tallerVariant } = require('../lib/photos');

const WF = JSON.parse(fs.readFileSync(path.join(__dirname, '../../n8n/AIFeed_Autopilot.json'), 'utf8'));
const code = name => WF.nodes.find(n => n.name === name).parameters.jsCode;
const AF = Object.getPrototypeOf(async function () {}).constructor;

async function fetchArticles(og, images) {
  const page = '<html><head><meta property="og:image" content="' + og + '"></head><body>' + '<p>' + 'x'.repeat(3000) + '</p></body></html>';
  const helpers = {
    async httpRequest(o) {
      if (o.encoding !== 'arraybuffer') return page;
      const img = images[o.url];
      if (!img) throw new Error('404');
      const buf = Buffer.alloc(img.size || 50000);
      // the real task runner serializes the Buffer; cover both shapes
      return { statusCode: 200, headers: { 'content-type': img.type || 'image/jpeg' }, body: img.serialized ? buf.toJSON() : buf };
    }
  };
  const $input = { first: () => ({ json: { candidates: [{ title: 'T', link: 'https://www.wired.com/story/x/', source: 'wired.com' }], history: [] } }) };
  const res = await new AF('$', '$input', '$runIndex', code('Fetch Articles')).call({ helpers }, null, $input, 0);
  return res[0].json.usable[0];
}

const OG = 'https://media.wired.com/photos/6ac81c8de30ca6995f7d2b30/191:100/w_1280,c_limit/P.jpg';
const SQ = 'https://media.wired.com/photos/6ac81c8de30ca6995f7d2b30/1:1/w_1600,c_limit/P.jpg';

test('n8n Fetch Articles uses the square crop of a wide WIRED photo, same as lib/photos.js', async () => {
  assert.equal(tallerVariant(OG), SQ);
  const c = await fetchArticles(OG, { [OG]: {}, [SQ]: {} });
  assert.equal(c.ogImage, SQ);
  assert.equal(c.photoOk, true);
});

test('n8n Fetch Articles keeps the original when the square crop does not load, and flags placeholder/missing photos', async () => {
  assert.equal((await fetchArticles(OG, { [OG]: {} })).ogImage, OG);
  const ph = await fetchArticles('https://cdn.example.com/img/og-default.png', {});
  assert.equal(ph.photoOk, false);
  assert.match(ph.photoProblem, /placeholder/);
  const tiny = await fetchArticles('https://cdn.example.com/p.jpg', { 'https://cdn.example.com/p.jpg': { size: 900 } });
  assert.equal(tiny.photoOk, false);
  const tinySer = await fetchArticles('https://cdn.example.com/p.jpg', { 'https://cdn.example.com/p.jpg': { size: 900, serialized: true } });
  assert.equal(tinySer.photoOk, false);
  assert.equal((await fetchArticles(OG, { [OG]: { serialized: true }, [SQ]: { serialized: true } })).ogImage, SQ);
});

test('n8n Quality node rejects a candidate without a usable photo and frames feed/story like lib/html.js', () => {
  const q = code('Quality Checks + Build HTML');
  assert.match(q, /c\.photoOk === false\) problems\.push\('photo: /);
  const html = fs.readFileSync(path.join(__dirname, '../lib/html.js'), 'utf8');
  for (const re of [/\.photo\{[^}]*height:1000px[^}]*\}/, /\.photo\{[^}]*top:80px[^}]*\}/]) {
    assert.equal(q.match(re)[0], html.match(re)[0]);
  }
});
