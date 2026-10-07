// Per-slot lock shared with the n8n fallback. Keyed by ET date + slot.
// status "claimed" or "posted" blocks another publisher. "released" does not.
// A history.json entry for the same date+slot also blocks, even if the claim was released.

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

function evaluateClaim({ claimsDoc, history, date, slot, takeOver = false } = {}) {
  const key = claimKey(date, slot);
  if (historyHasSlot(history, date, slot)) {
    return { ok: false, key, reason: `history already has a post for ${key}` };
  }
  const row = claimsDoc && claimsDoc.claims ? claimsDoc.claims[key] : null;
  const status = normalizeStatus(row);
  if (status === 'posted') {
    return { ok: false, key, reason: `slot ${key} is posted${row.by ? ' by ' + row.by : ''}${row.at ? ' at ' + row.at : ''}` };
  }
  if (status === 'claimed' && !takeOver) {
    return { ok: false, key, reason: `slot ${key} is claimed${row.by ? ' by ' + row.by : ''}${row.at ? ' at ' + row.at : ''}` };
  }
  return { ok: true, key, reason: status === 'claimed' && takeOver ? `taking over stale claim ${key}` : `slot ${key} is free` };
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
  claims[key] = Object.assign({}, extra || {}, { status, at, by });
  return { ok: true, key, doc: { claims: pruneClaims(claims, now) } };
}

module.exports = {
  CLAIM_PATH, SlotTaken, claimKey, historyHasSlot, evaluateClaim, pruneClaims, updateClaimDoc
};
