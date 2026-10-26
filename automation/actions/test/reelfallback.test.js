const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { renderReelSafe, sceneEnv } = require('../lib/reels');
const { reelTemplateOpts, carouselFallback } = require('../lib/reelsplan');

const mp4 = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rr-')), 'x.mp4');
fs.writeFileSync(mp4, 'fake');
const quiet = () => {};

test('v3 render failure retries with the v2 template (never carousel-only)', () => {
  const calls = [];
  const render = (repo, post, png, photo, opts) => {
    calls.push(opts.template);
    if (opts.template === 'v3') throw new Error('Python int too large to convert to C ssize_t');
    return { mp4 };
  };
  const rr = renderReelSafe('/r', { slug: 's' }, 'p.png', '', { template: 'v3', hookStyle: 'A' }, { render, log: quiet });
  assert.deepStrictEqual(calls, ['v3', 'v2']);
  assert.strictEqual(rr.template, 'v2');
  assert.match(rr.v3Error, /ssize_t/);
  // the Reel exists -> in Reels-only mode the publish path runs, not the carousel fallback
  assert.strictEqual(carouselFallback({ igCarouselEnabled: false, reelsEnabled: true, reelsPublishEnabled: true }, true), false);
});

test('v3 that returns no mp4 (or a timeout) also retries with v2', () => {
  const calls = [];
  const render = (r, p, f, ph, opts) => { calls.push(opts.template); return opts.template === 'v3' ? { mp4: '/nope/missing.mp4' } : { mp4 }; };
  assert.strictEqual(renderReelSafe('/r', {}, 'p', '', { template: 'v3' }, { render, log: quiet }).template, 'v2');
  const calls2 = [];
  const timeout = (r, p, f, ph, opts) => { calls2.push(opts.template); if (opts.template === 'v3') { const e = new Error('spawnSync python3 ETIMEDOUT'); e.code = 'ETIMEDOUT'; throw e; } return { mp4 }; };
  assert.strictEqual(renderReelSafe('/r', {}, 'p', '', { template: 'v3' }, { render: timeout, log: quiet }).template, 'v2');
  assert.deepStrictEqual(calls2, ['v3', 'v2']);
});

test('v3 success renders once; v2 config renders v2 once', () => {
  const calls = [];
  const render = (r, p, f, ph, opts) => { calls.push(opts.template); return { mp4 }; };
  assert.strictEqual(renderReelSafe('/r', {}, 'p', '', { template: 'v3' }, { render, log: quiet }).template, 'v3');
  assert.strictEqual(renderReelSafe('/r', {}, 'p', '', {}, { render, log: quiet }).template, 'v2');
  assert.deepStrictEqual(calls, ['v3', 'v2']);
});

test('a v2 failure still throws (handled by the existing Reel error path)', () => {
  const render = () => { throw new Error('boom'); };
  assert.throws(() => renderReelSafe('/r', {}, 'p', '', { template: 'v3' }, { render, log: quiet }), /boom/);
});

test('one setting drives brief and renderer', () => {
  assert.deepStrictEqual(reelTemplateOpts({}, {}), { template: 'v2', hookStyle: '' });
  assert.deepStrictEqual(reelTemplateOpts({ reelTemplate: 'V3', reelHookStyle: 'b' }, {}), { template: 'v3', hookStyle: 'B' });
  assert.strictEqual(reelTemplateOpts({}, { AIFEED_REEL_TEMPLATE: 'v3' }).template, 'v3');
  assert.strictEqual(reelTemplateOpts({ reelTemplate: 'v3' }, { AIFEED_REEL_TEMPLATE: 'v2' }).template, 'v2');
  assert.strictEqual(reelTemplateOpts({ reelTemplate: 'v3' }, { AIFEED_REEL_TEMPLATE: '' }).template, 'v3');
  assert.strictEqual(reelTemplateOpts(require('../config.json'), {}).template, 'v2'); // config unchanged: v2 stays live
});

test('renderer env is always explicit, never inherited from the job env', () => {
  const inherited = { AIFEED_REEL_TEMPLATE: 'v3', AIFEED_HOOK_STYLE: 'C', PATH: '/bin' };
  const v2 = sceneEnv({ template: 'v2' }, inherited);
  assert.strictEqual(v2.AIFEED_REEL_TEMPLATE, 'v2'); assert.strictEqual(v2.AIFEED_HOOK_STYLE, undefined);
  assert.strictEqual(sceneEnv({}, inherited).AIFEED_REEL_TEMPLATE, 'v2');
  const v3 = sceneEnv({ template: 'v3', hookStyle: 'A' }, {});
  assert.strictEqual(v3.AIFEED_REEL_TEMPLATE, 'v3'); assert.strictEqual(v3.AIFEED_HOOK_STYLE, 'A');
  assert.strictEqual(v3.AIFEED_SCENE_CF, 'off');
});

test('v3 and v2 both failing: error names both templates and reasons, and the alert says carousel last resort', () => {
  const { reelFailureAlert } = require('../lib/reelsplan');
  const render = (r, p, f, ph, opts) => { throw new Error(opts.template + ' crashed'); };
  let err;
  try { renderReelSafe('/r', {}, 'p', '', { template: 'v3' }, { render, log: quiet }); } catch (e) { err = e; }
  assert.deepStrictEqual(err.templatesFailed, ['v3', 'v2']);
  assert.match(err.message, /v3: v3 crashed \| v2: v2 crashed/);
  const msg = reelFailureAlert('render', true, err.templatesFailed, err.message);
  assert.match(msg, /Reel render failed \(templates failed: v3 \+ v2\)/);
  assert.match(msg, /carousel as LAST-RESORT fallback/);
  assert.match(msg, /Reason: v3: v3 crashed \| v2: v2 crashed/);
  assert.match(reelFailureAlert('publish', true, [], 'Graph 500'), /Instagram Reel publish failed, posting the carousel as LAST-RESORT fallback\nReason: Graph 500/);
});

test('pipeline: every path into the carousel fallback alerts', () => {
  const src = fs.readFileSync(path.join(__dirname, '../pipeline.js'), 'utf8');
  assert.equal((src.match(/reelFailureAlert\('render', reelsOnly, e\.templatesFailed/g) || []).length, 1);
  assert.equal((src.match(/reelFailureAlert\('publish', reelsOnly/g) || []).length, 1);
  const fb = src.slice(src.indexOf('if (carouselFallback(cfg, reelPublished))'));
  assert.match(fb.slice(0, 400), /if \(!reelAlerted\) await sendAlert\(reelFailureAlert/);
});
