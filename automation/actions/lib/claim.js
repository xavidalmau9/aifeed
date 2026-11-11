// Per-slot lock shared with the n8n fallback. Keyed by ET date + slot.
// status "claimed" or "posted" blocks another publisher. "released" does not.
// A history.json entry for the same date+slot also blocks, even if the claim was released.
// A released slot may be claimed again (the ~45 min retry). Scheduled runs stop after
// MAX_SLOT_ATTEMPTS so a slot that keeps failing is not retried all afternoon.
// Posted is never overwritten, and history still blocks, so a retry cannot double-post.

const MAX_SLOT_ATTEMPTS = 2;

const CLAIM_PATH = '_data/slot-claims.json';
const DAY_MS = 86400000;

class SlotTaken extends Error {
  constructor(message) {
    super(message);
    this.code = 'SLOT_TAKEN';
  }
}

function claimKey(date, slot) {
  return `${date}:${Number(slot)}`;
}

function normalizeStatus(row) {
  return row && row.status ? String(row.status).toLowerCase() : '';
}

function historyHasSlot(history, date, slot) {
  return ((history && history.posted) || []).some(p => p && p.date === date && Number(p.slot) === Number(slot));
}

function attemptCount(row) {
  if (!row) return 0;
  // Rows released before attempts were stored (the Nov 10 slot) already used one try.
  if (row.attempts == null || row.attempts === '') return normalizeStatus(row) === 'released' ? 1 : 0;
  const n = Number(row.attempts);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function triedList(row) {
  return Array.isArray(row && row.tried) ? row.tried.filter(Boolean).map(String) : [];
}

function mergeTried(prev, more) {
  const out = [];
  for (const u of [].concat(prev || [], more || [])) {
    const s = String(u || '').trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out.slice(0, 40);
}

function evaluateClaim({ claimsDoc, history, date, slot, takeOver = false, manual = false } = {}) {
  const key = claimKey(date, slot);
  if (historyHasSlot(history, date, slot)) {
    return { ok: false, key, reason: `history already has a post for ${key}` };
  }
  const row = claimsDoc && claimsDoc.claims ? claimsDoc.claims[key] : null;
  const status = normalizeStatus(row);
  const attempts = attemptCount(row);
  const tried = triedList(row);
  if (status === 'posted') {
    return { ok: false, key, reason: `slot ${key} is posted${row.by ? ' by ' + row.by : ''}${row.at ? ' at ' + row.at : ''}` };
  }
  if (status === 'claimed' && !takeOver) {
    return { ok: false, key, reason: `slot ${key} is claimed${row.by ? ' by ' + row.by : ''}${row.at ? ' at ' + row.at : ''}` };
  }
  // A released claim is free for one scheduled retry. Further scheduled runs stop.
  // A manual workflow_dispatch can still try (a person asked); posted and history above still win.
  if (status === 'released' && attempts >= MAX_SLOT_ATTEMPTS && !manual) {
    return {
      ok: false,
      key,
      attempts,
      tried,
      reason: `slot ${key} was released after ${attempts} attempts; not retrying`
    };
  }
  const retry = status === 'released';
  let reason = `slot ${key} is free`;
  if (status === 'claimed' && takeOver) reason = `taking over stale claim ${key}`;
  else if (retry) reason = `slot ${key} was released after attempt ${attempts || 1}; retrying`;
  return { ok: true, key, reason, retry, attempts, tried };
}

function dropSlotHistory(history, date, slot) {
  const h = history && typeof history === 'object' ? Object.assign({}, history) : {};
  const posted = Array.isArray(h.posted) ? h.posted : [];
  h.posted = posted.filter(p => !(p && p.date === date && Number(p.slot) === Number(slot)));
  if (!h.rankings || typeof h.rankings !== 'object') h.rankings = {};
  return h;
}

// Claim goes back to released and the date+slot history row is removed, so the
// 8:48 / 17:48 retry can run. The website post stays in posts-index.json.
function unpublishedSlotUpdate(claimsDoc, history, { date, slot, at, by = 'github-actions', tried, now = Date.now() } = {}) {
  const next = updateClaimDoc(claimsDoc, {
    date, slot, status: 'released', at, by, now, extra: { tried: tried || [] }
  });
  return {
    ok: next.ok,
    key: next.key,
    reason: next.reason,
    claims: next.doc,
    history: dropSlotHistory(history, date, slot)
  };
}

function pruneClaims(claims, now = Date.now()) {
  const out = {};
  for (const [key, row] of Object.entries(claims || {})) {
    if (!row) continue;
    if (normalizeStatus(row) === 'claimed') { out[key] = row; continue; }
    const t = row.at ? new Date(row.at).getTime() : NaN;
    if (Number.isNaN(t) || now - t < 60 * DAY_MS) out[key] = row;
  }
  return out;
}

/**
 * Pure claim-file update. Refuses to claim a slot that is already claimed or posted
 * unless takeOver is set (claimed only; posted is never overwritten).
 */
function updateClaimDoc(doc, { date, slot, status, at, by = 'github-actions', extra, takeOver = false, now = Date.now() } = {}) {
  const key = claimKey(date, slot);
  const claims = Object.assign({}, (doc && doc.claims) || {});
  const cur = claims[key];
  const curStatus = normalizeStatus(cur);
  if (status === 'claimed' && curStatus === 'posted') {
    return { ok: false, key, reason: `slot ${key} is posted`, doc: doc || { claims } };
  }
  if (status === 'claimed' && curStatus === 'claimed' && !takeOver) {
    return { ok: false, key, reason: `slot ${key} is claimed`, doc: doc || { claims } };
  }
  if (status === 'released' && curStatus === 'posted') {
    return { ok: false, key, reason: `refusing to release posted slot ${key}`, doc: doc || { claims } };
  }
  const prevAttempts = attemptCount(cur);
  // Reclaiming a stuck "claimed" row is the same attempt, not a new one.
  const attempts = status === 'claimed'
    ? (curStatus === 'claimed' && takeOver ? (prevAttempts || 1) : prevAttempts + 1)
    : prevAttempts;
  const rest = Object.assign({}, extra || {});
  const tried = status === 'posted'
    ? []
    : (Array.isArray(rest.tried) ? mergeTried(rest.tried, []) : triedList(cur));
  delete rest.tried;
  delete rest.attempts;
  delete rest.status;
  delete rest.at;
  delete rest.by;
  claims[key] = Object.assign({}, rest, { status, at, by, attempts, tried });
  return { ok: true, key, doc: { claims: pruneClaims(claims, now) } };
}

module.exports = {
  CLAIM_PATH, MAX_SLOT_ATTEMPTS, SlotTaken, claimKey, historyHasSlot, mergeTried,
  evaluateClaim, pruneClaims, updateClaimDoc, dropSlotHistory, unpublishedSlotUpdate
};
