const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const h = require('../lib/hooktest');
const { reelTemplateOpts } = require('../lib/reelsplan');

test('rotation A->B->C starts at 2026-11-02 slot 2, ends 2026-11-16', () => {
  assert.strictEqual(h.rotatedStyle('2026-11-02', 1), '');
  assert.strictEqual(h.rotatedStyle('2026-11-02', 2), 'A');
  assert.strictEqual(h.rotatedStyle('2026-11-03', 1), 'B');
  assert.strictEqual(h.rotatedStyle('2026-11-03', 2), 'C');
  assert.strictEqual(h.rotatedStyle('2026-11-04', 1), 'A');
  assert.strictEqual(h.rotatedStyle('2026-11-16', 2), ['A', 'B', 'C'][(14 * 2) % 3]);
  assert.strictEqual(h.rotatedStyle('2026-11-17', 1), '');
  assert.strictEqual(h.rotatedStyle('bad', 1), '');
  const seen = { A: 0, B: 0, C: 0 };
  for (let d = 2; d <= 16; d++) for (const s of [1, 2]) { const x = h.rotatedStyle('2026-11-' + String(d).padStart(2, '0'), s); if (x) seen[x]++; }
  assert.deepStrictEqual(seen, { A: 10, B: 10, C: 9 });
});

test('explicit style overrides rotate; env wins', () => {
  const d = { date: '2026-11-02', slot: 2 };
  assert.strictEqual(h.resolveHookStyle({ reelHookStyle: 'rotate' }, {}, d), 'A');
  assert.strictEqual(h.resolveHookStyle({ reelHookStyle: 'rotate' }, { AIFEED_HOOK_STYLE: 'c' }, d), 'C');
  assert.strictEqual(h.resolveHookStyle({ reelHookStyle: 'B' }, {}, d), 'B');
  assert.strictEqual(h.resolveHookStyle({ reelHookStyle: 'B' }, { AIFEED_HOOK_STYLE: 'rotate' }, d), 'A');
  assert.strictEqual(h.resolveHookStyle({}, {}, d), '');
  assert.deepStrictEqual(reelTemplateOpts({ reelTemplate: 'v3', reelHookStyle: 'rotate' }, {}, { date: '2026-11-03', slot: 1 }), { template: 'v3', hookStyle: 'B' });
  assert.deepStrictEqual(reelTemplateOpts({ reelTemplate: 'v2', reelHookStyle: 'rotate' }, {}, d), { template: 'v2', hookStyle: '' });
});

test('CSV log appends once per Reel and claim fields', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-'));
  const r = { date: '2026-11-02', slot: 2, slug: 'a-b', template: 'v3', hookStyle: 'A', igReelId: '123', permalink: 'https://www.instagram.com/reel/X/' };
  assert.strictEqual(h.appendHookRow(repo, r), h.CSV_PATH);
  assert.strictEqual(h.appendHookRow(repo, r), null);
  h.appendHookRow(repo, Object.assign({}, r, { igReelId: '124', slug: 'x,"y"' }));
  const lines = fs.readFileSync(path.join(repo, h.CSV_PATH), 'utf8').trim().split('\n');
  assert.strictEqual(lines[0], h.CSV_HEADER);
  assert.strictEqual(lines[1], '2026-11-02,2,a-b,v3,A,123,https://www.instagram.com/reel/X/');
  assert.strictEqual(lines.length, 3);
  assert.deepStrictEqual(h.claimFields(r), { reelTemplate: 'v3', hookStyle: 'A', igReelId: '123', igPermalink: r.permalink });
});
