// v3 Reel hook A/B/C test (Javier approved Nov 2 2026). reelHookStyle "rotate" = rotate A -> B -> C across slots
// during the test window; an explicit A/B/C in env AIFEED_HOOK_STYLE or config reelHookStyle always wins.
const fs = require('fs');
const path = require('path');

const HOOK_TEST = { startDate: '2026-11-02', startSlot: 2, endDate: '2026-11-16', styles: ['A', 'B', 'C'] };
const CSV_PATH = '_data/reel-hook-test.csv';
const CSV_HEADER = 'date,slot,slug,template,hookStyle,igReelId,permalink';

function dayNum(date) { return Math.round(Date.parse(String(date) + 'T00:00:00Z') / 86400000); }

// Slot index since the test start (2 slots/day). null outside the window.
function rotationIndex(date, slot, t = HOOK_TEST) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return null;
  if (String(date) < t.startDate || String(date) > t.endDate) return null;
  const idx = (dayNum(date) - dayNum(t.startDate)) * 2 + (Number(slot) - t.startSlot);
  return idx < 0 ? null : idx;
}

// Phase 2 (Javier approved Nov 16 2026, after the weekly growth analysis): hook C ("what it means for you") gets ~50%
// of slots, A and B ~25% each, and the Reel template alternates v2 / v3 on comparable slots. The 8-slot cycle is
// balanced: C lands on am and pm and on both templates, A and B each get one v2 and one v3, and each template gets
// 2 am + 2 pm slots per cycle. Used when config reelHookStyle / reelTemplate are "rotate".
const HOOK_TEST2 = {
  startDate: '2026-11-16', startSlot: 2, endDate: '2026-12-14',
  cycle: [['C', 'v3'], ['A', 'v2'], ['C', 'v2'], ['B', 'v3'], ['A', 'v3'], ['C', 'v3'], ['B', 'v2'], ['C', 'v2']]
};

function phase2Entry(date, slot) {
  const i = rotationIndex(date, slot, HOOK_TEST2);
  return i == null ? null : HOOK_TEST2.cycle[i % HOOK_TEST2.cycle.length];
}

function rotatedStyle(date, slot, t = HOOK_TEST) {
  if (t === HOOK_TEST) { const e = phase2Entry(date, slot); if (e) return e[0]; }
  const i = rotationIndex(date, slot, t);
  return i == null ? '' : t.styles[i % t.styles.length];
}

// Template for "rotate": the phase 2 v2/v3 comparison, else '' (the caller falls back to v3).
function rotatedTemplate(date, slot) {
  const e = phase2Entry(date, slot);
  return e ? e[1] : '';
}

// Resolve the hook style: explicit env A/B/C > explicit config A/B/C > "rotate" (env or config) in window > ''.
function resolveHookStyle(cfg = {}, env = {}, decision = {}) {
  const e = String(env.AIFEED_HOOK_STYLE || '').trim().toUpperCase();
  const c = String(cfg.reelHookStyle || '').trim().toUpperCase();
  if (/^[ABC]$/.test(e)) return e;
  if (e === 'ROTATE' || (!e && c === 'ROTATE')) return rotatedStyle(decision.date, decision.slot);
  if (/^[ABC]$/.test(c)) return c;
  return '';
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvRow(r) {
  return [r.date, r.slot, r.slug, r.template, r.hookStyle, r.igReelId, r.permalink].map(csvCell).join(',');
}
// Append one row (idempotent per igReelId). Returns the repo-relative path written, or null if already present.
function appendHookRow(repo, r) {
  const p = path.join(repo, CSV_PATH);
  let cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  if (!cur.trim()) cur = CSV_HEADER + '\n';
  if (!cur.endsWith('\n')) cur += '\n';
  if (r.igReelId && cur.split('\n').some(l => l.split(',')[5] === String(r.igReelId))) return null;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, cur + csvRow(r) + '\n');
  return CSV_PATH;
}
// Fields saved on the slot's entry in _data/slot-claims.json.
function claimFields(r) {
  const o = { reelTemplate: r.template || 'v2', hookStyle: r.hookStyle || '' };
  if (r.igReelId) o.igReelId = String(r.igReelId);
  if (r.permalink) o.igPermalink = r.permalink;
  return o;
}

module.exports = { HOOK_TEST, HOOK_TEST2, rotatedTemplate, CSV_PATH, CSV_HEADER, rotationIndex, rotatedStyle, resolveHookStyle, csvRow, appendHookRow, claimFields };
