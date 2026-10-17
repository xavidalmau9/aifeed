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
  assert.deepStrictEqual(r, { mp4: '/t/a.mp4', cover: '', credit: 'P', punch: '', sceneSource: '', sceneLog: [] });
});

// ---- Cloudflare quota: only the live post may use Workers AI ----
test('sceneEnv: Cloudflare is off unless the caller is the live post', () => {
  const { sceneEnv } = require('../lib/reels');
  assert.equal(sceneEnv({}, {}).AIFEED_SCENE_CF, 'off');
  assert.equal(sceneEnv(undefined, { AIFEED_SCENE_CF: 'on' }).AIFEED_SCENE_CF, 'off');
  assert.equal(sceneEnv({ cloudflare: 'yes' }, {}).AIFEED_SCENE_CF, 'off');
  assert.equal(sceneEnv({ cloudflare: true }, {}).AIFEED_SCENE_CF, 'on');
  assert.equal(sceneEnv({ sceneCache: '/tmp/raw' }, {}).AIFEED_SCENE_CACHE, '/tmp/raw');
  assert.equal(sceneEnv({}, { PATH: '/bin' }).PATH, '/bin');
});

test('pipeline: the live Reel is the only Cloudflare user; the dry run renders with it off', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../pipeline.js'), 'utf8');
  const calls = src.match(/renderReel\([^;]*;/g) || [];
  assert.equal(calls.length, 2);
  assert.equal(calls.filter(c => /\{ cloudflare: true \}/.test(c)).length, 1);
  assert.equal(calls.filter(c => /\{ cloudflare: false \}/.test(c)).length, 1);
  assert.match(calls.find(c => /cloudflare: true/.test(c)), /tmpPng/); // the live path (dry run uses fp)
});

test('samples never get Cloudflare: no CF secrets in reels-samples.yml, no schedule, flag off by default', () => {
  const fs = require('fs'); const p = require('path');
  const yml = fs.readFileSync(p.join(__dirname, '../../../.github/workflows/reels-samples.yml'), 'utf8');
  assert.doesNotMatch(yml, /secrets\.CF_/);
  assert.doesNotMatch(yml, /^\s*(schedule|cron|push|pull_request)\b/m);
  const js = fs.readFileSync(p.join(__dirname, '../../reels/render_samples.js'), 'utf8');
  assert.match(js, /cloudflare: process\.env\.SAMPLES_USE_CF === '1'/);
  assert.doesNotMatch(yml, /SAMPLES_USE_CF/);
});

test('CI numpy guard: every node test that shells out to python3 skips when numpy/Pillow are missing', () => {
  const fs = require('fs'); const p = require('path');
  for (const f of fs.readdirSync(__dirname).filter(n => n.endsWith('.test.js'))) {
    const src = fs.readFileSync(p.join(__dirname, f), 'utf8');
    const pyTests = src.split(/\ntest\(/).slice(1).filter(t => /execFileSync\('python3', \['-m', 'unittest'/.test(t));
    for (const t of pyTests) assert.match(t.split('\n')[0], /skip: hasPyDeps \? false :/, f);
  }
});
