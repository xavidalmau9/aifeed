const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const h = require('../lib/hooktest');
const { reelTemplateOpts } = require('../lib/reelsplan');

test('rotation A->B->C starts at 2026-11-02 slot 2, phase 1 ends 2026-11-16 am', () => {
  assert.strictEqual(h.rotatedStyle('2026-11-02', 1), '');
  assert.strictEqual(h.rotatedStyle('2026-11-02', 2), 'A');
  assert.strictEqual(h.rotatedStyle('2026-11-03', 1), 'B');
  assert.strictEqual(h.rotatedStyle('2026-11-03', 2), 'C');
  assert.strictEqual(h.rotatedStyle('2026-11-04', 1), 'A');
  assert.strictEqual(h.rotatedStyle('2026-11-16', 1), 'A');
  assert.strictEqual(h.rotatedStyle('bad', 1), '');
  const seen = { A: 0, B: 0, C: 0 };
  for (let d = 2; d <= 15; d++) for (const s of [1, 2]) { const x = h.rotatedStyle('2026-11-' + String(d).padStart(2, '0'), s); if (x) seen[x]++; }
  assert.deepStrictEqual(seen, { A: 9, B: 9, C: 9 });
});

test('phase 2 (2026-11-16 pm .. 2026-12-14): ~50% C, 25% A/B, v2/v3 alternate, balanced by slot', () => {
  assert.strictEqual(h.rotatedStyle('2026-11-16', 2), 'C');
  assert.strictEqual(h.rotatedTemplate('2026-11-16', 2), 'v3');
  assert.strictEqual(h.rotatedTemplate('2026-11-16', 1), '');
  assert.strictEqual(h.rotatedStyle('2026-12-15', 1), '');
  assert.strictEqual(h.rotatedTemplate('2026-12-15', 1), '');
  const n = { A: 0, B: 0, C: 0 }, tpl = { v2: 0, v3: 0 }, combo = {}, bySlot = {};
  // 4 full cycles = 16 days from 11-16 pm
  for (let i = 0; i < 32; i++) {
    const day = new Date(Date.UTC(2026, 10, 16) + Math.floor((i + 1) / 2) * 86400000).toISOString().slice(0, 10);
    const slot = (i + 1) % 2 === 0 ? 1 : 2;
    const st = h.rotatedStyle(day, slot), tp = h.rotatedTemplate(day, slot);
    n[st]++; tpl[tp]++; combo[st + tp] = (combo[st + tp] || 0) + 1; bySlot[tp + slot] = (bySlot[tp + slot] || 0) + 1;
  }
  assert.deepStrictEqual(n, { A: 8, B: 8, C: 16 });
  assert.deepStrictEqual(tpl, { v2: 16, v3: 16 });
  assert.deepStrictEqual(combo, { Cv3: 8, Cv2: 8, Av2: 4, Av3: 4, Bv2: 4, Bv3: 4 });
  assert.deepStrictEqual(bySlot, { v31: 8, v32: 8, v21: 8, v22: 8 });
});

test('reelTemplate "rotate" picks the slot template and keeps the hook on v2 too', () => {
  const cfg = { reelTemplate: 'rotate', reelHookStyle: 'rotate' };
  assert.deepStrictEqual(reelTemplateOpts(cfg, {}, { date: '2026-11-16', slot: 2 }), { template: 'v3', hookStyle: 'C' });
  assert.deepStrictEqual(reelTemplateOpts(cfg, {}, { date: '2026-11-17', slot: 1 }), { template: 'v2', hookStyle: 'A' });
  assert.deepStrictEqual(reelTemplateOpts(cfg, {}, { date: '2027-01-05', slot: 1 }), { template: 'v3', hookStyle: '' });
  assert.deepStrictEqual(reelTemplateOpts(cfg, { AIFEED_REEL_TEMPLATE: 'v3' }, { date: '2026-11-17', slot: 1 }), { template: 'v3', hookStyle: 'A' });
  assert.deepStrictEqual(reelTemplateOpts(require('../config.json'), {}, { date: '2026-11-17', slot: 2 }), { template: 'v2', hookStyle: 'C' });
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
