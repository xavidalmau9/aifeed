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

test('pipeline: one scene pick per post; Cloudflare only on the live path, the Reel reuses the carousel scene', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../pipeline.js'), 'utf8');
  const reels = src.match(/renderReel\([^;]*;/g) || [];
  assert.equal(reels.length, 2);
  assert.ok(reels.every(c => /reelSceneOpts/.test(c))); // both Reel renders reuse the carousel's scene when there is one
  assert.equal(reels.filter(c => /\{ cloudflare: false \}/.test(c)).length, 1); // dry run: never
  assert.equal(reels.filter(c => /\{ cloudflare: !slides \}/.test(c)).length, 1); // live: only if the slides failed
  const slides = src.match(/renderSlides\([^;]*;/g) || [];
  assert.equal(slides.length, 1);
  assert.match(slides[0], /cloudflare: !env\.DRY_RUN/);
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

test('carousel v2: make_slides renders 4:5 slides + a 9:16 Story from one shared scene', { skip: (() => { try { require('child_process').execFileSync('python3', ['-c', 'import numpy, PIL']); return false; } catch (e) { return 'numpy/Pillow missing'; } })() }, () => {
  const fs = require('fs'); const os = require('os'); const p = require('path'); const cp = require('child_process');
  const repo = p.join(__dirname, '../../..'); const tmp = fs.mkdtempSync(p.join(os.tmpdir(), 'slides-t-'));
  const scene = p.join(tmp, 'in.jpg');
  cp.execFileSync('python3', ['-c', `import numpy as np;from PIL import Image;a=(np.random.default_rng(3).random((1920,1080,3))*120).astype('uint8');Image.fromarray(a).save('${scene}')`]);
  const post = { slug: 't', category: 'Business', headline: 'Disney asked Character.AI to go bankrupt', punch: 'DISNEY SEEKS / *CHARACTER.AI / BANKRUPTCY',
    summary: 'Court filings show Disney paid $5.5 million upfront to hire most of the startup staff. The startup faced multiple lawsuits over chatbot safety from regulators worldwide.', body: '' };
  fs.writeFileSync(p.join(tmp, 'post.json'), JSON.stringify(post));
  const out = cp.execFileSync('python3', [p.join(repo, 'automation/reels/make_slides.py'), '--post', p.join(tmp, 'post.json'), '--out-dir', tmp, '--scene', scene, '--scene-source', 'library'], { encoding: 'utf8', env: Object.assign({}, process.env, { AIFEED_SCENE_CF: 'off' }) });
  const r = JSON.parse(out.trim().split('\n').pop());
  const { pngSize } = require('../lib/png');
  assert.ok(r.slides.length >= 3);
  r.slides.forEach(s => assert.deepEqual(pngSize(fs.readFileSync(s)), { width: 1080, height: 1350 }));
  assert.deepEqual(pngSize(fs.readFileSync(r.story)), { width: 1080, height: 1920 });
  assert.equal(r.sceneSource, 'library');
});
