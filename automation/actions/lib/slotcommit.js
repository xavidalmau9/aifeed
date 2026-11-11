// Commit a slot-claim update. Shared by the normal autopilot and the finish path.
const { CLAIM_PATH, evaluateClaim, updateClaimDoc, unpublishedSlotUpdate, SlotTaken } = require('./claim');
const { readJson, writeJson, commitApply } = require('./git');

function writeClaim(env, decision, status, { takeOver = false, extra } = {}) {
  const label = Number(decision.slot) === 1 ? 'am' : 'pm';
  const message = status === 'claimed'
    ? `Claim slot ${decision.date} ${label}`
    : status === 'posted'
      ? `Posted slot ${decision.date} ${label}`
      : `Release slot ${decision.date} ${label}`;
  commitApply(env.REPO, message, () => {
    const freshHist = readJson(env.REPO, '_data/history.json', { posted: [], rankings: {} });
    const freshClaims = readJson(env.REPO, CLAIM_PATH, { claims: {} });
    if (status === 'claimed') {
      const gate = evaluateClaim({
        claimsDoc: freshClaims, history: freshHist, date: decision.date, slot: decision.slot, takeOver
      });
      if (!gate.ok) throw new SlotTaken(gate.reason);
    }
    const next = updateClaimDoc(freshClaims, {
      date: decision.date,
      slot: decision.slot,
      status,
      at: new Date().toISOString(),
      by: 'github-actions',
      extra,
      takeOver: status === 'claimed' && takeOver
    });
    if (!next.ok) throw new SlotTaken(next.reason);
    writeJson(env.REPO, CLAIM_PATH, next.doc);
    return [CLAIM_PATH];
  });
}

// The article files are already on main, but the public page never became the story.
// Release the claim and drop this slot's history row in one commit so the retry can post.
function releaseUnpublishedSlot(env, decision, { tried } = {}) {
  const label = Number(decision.slot) === 1 ? 'am' : 'pm';
  commitApply(env.REPO, `Release slot ${decision.date} ${label}: article page not live`, () => {
    const freshHist = readJson(env.REPO, '_data/history.json', { posted: [], rankings: {} });
    const freshClaims = readJson(env.REPO, CLAIM_PATH, { claims: {} });
    const next = unpublishedSlotUpdate(freshClaims, freshHist, {
      date: decision.date,
      slot: decision.slot,
      at: new Date().toISOString(),
      by: 'github-actions',
      tried: tried || []
    });
    if (!next.ok) throw new SlotTaken(next.reason);
    writeJson(env.REPO, '_data/history.json', next.history);
    writeJson(env.REPO, CLAIM_PATH, next.claims);
    return [CLAIM_PATH, '_data/history.json'];
  });
}

module.exports = { writeClaim, releaseUnpublishedSlot };
