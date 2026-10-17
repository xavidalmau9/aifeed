const test = require('node:test');
const assert = require('node:assert');
const { withPhotoCredit, publishIgReel, parseRenderResult } = require('../lib/reels');
const credit = 'Photo: Ank Kumar / CC BY-SA 4.0 via Wikimedia Commons (https://commons.wikimedia.org/wiki/File:X.jpg)';

test('photo credit goes before trailing hashtags, without URL, once', () => {
  const out = withPhotoCredit('Story text.\n\n#A #B', credit);
  assert.strictEqual(out, 'Story text.\n\nPhoto: Ank Kumar / CC BY-SA 4.0 via Wikimedia Commons\n\n#A #B');
  assert.strictEqual(withPhotoCredit(out, credit), out);
});
test('no credit leaves caption unchanged', () => {
  assert.strictEqual(withPhotoCredit('Hi #A', ''), 'Hi #A');
});
test('IG Reel container carries cover_url when given', async () => {
  const calls = [];
  const graphForm = async (url, f) => { calls.push([url, f]); return { id: 'x' }; };
  await publishIgReel({ graphVersion: 'v21.0', igUserId: '1' }, {}, { graphForm, pollContainer: async () => {} }, 'https://v/a.mp4', 'cap', 'https://v/a_cover.jpg');
  assert.strictEqual(calls[0][1].cover_url, 'https://v/a_cover.jpg');
  calls.length = 0;
  await publishIgReel({ graphVersion: 'v21.0', igUserId: '1' }, {}, { graphForm, pollContainer: async () => {} }, 'https://v/a.mp4', 'cap');
  assert.ok(!('cover_url' in calls[0][1]));
});
test('parseRenderResult reads make_reel JSON line', () => {
  const r = parseRenderResult('noise\n{"out":"/t/a.mp4","cover":"/nope.jpg","photoCredit":"P"}\n', '/t/a.mp4');
  assert.deepStrictEqual(r, { mp4: '/t/a.mp4', cover: '', credit: 'P' });
});
