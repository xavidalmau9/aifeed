const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateClaim, updateClaimDoc, claimKey, historyHasSlot, mergeTried, unpublishedSlotUpdate, MAX_SLOT_ATTEMPTS } = require('../lib/claim');

const date = '2026-10-07';
const at = '2026-10-07T12:00:00.000Z';

test('a free slot can be claimed, and claimed or posted blocks the other publisher', () => {
  const empty = evaluateClaim({ claimsDoc: { claims: {} }, history: { posted: [] }, date, slot: 1 });
  assert.equal(empty.ok, true);
  assert.equal(empty.key, claimKey(date, 1));

  const claimedDoc = updateClaimDoc({ claims: {} }, { date, slot: 1, status: 'claimed', at, by: 'github-actions' });
  assert.equal(claimedDoc.ok, true);
  const blocked = evaluateClaim({ claimsDoc: claimedDoc.doc, history: { posted: [] }, date, slot: 1 });
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /claimed/);

  const again = updateClaimDoc(claimedDoc.doc, { date, slot: 1, status: 'claimed', at, by: 'n8n' });
  assert.equal(again.ok, false);

  const posted = updateClaimDoc(claimedDoc.doc, { date, slot: 1, status: 'posted', at, by: 'github-actions' });
  assert.equal(posted.ok, true);
  const postedBlock = evaluateClaim({ claimsDoc: posted.doc, history: { posted: [] }, date, slot: 1 });
  assert.equal(postedBlock.ok, false);
  assert.match(postedBlock.reason, /posted/);
  assert.equal(updateClaimDoc(posted.doc, { date, slot: 1, status: 'released', at }).ok, false);
});

test('history for the same date and slot blocks even when the claim was released', () => {
  const history = { posted: [{ date, slot: 2, headline: 'Already up' }] };
  assert.equal(historyHasSlot(history, date, 2), true);
  assert.equal(historyHasSlot(history, date, 1), false);
  const doc = updateClaimDoc({ claims: {} }, { date, slot: 2, status: 'released', at, by: 'github-actions' });
  const gate = evaluateClaim({ claimsDoc: doc.doc, history, date, slot: 2 });
  assert.equal(gate.ok, false);
  assert.match(gate.reason, /history/);
  const other = evaluateClaim({ claimsDoc: doc.doc, history, date, slot: 1 });
  assert.equal(other.ok, true);
});

test('a released slot can be claimed once more, then scheduled runs stop', () => {
  const key = claimKey(date, 1);
  let doc = updateClaimDoc({ claims: {} }, { date, slot: 1, status: 'claimed', at, by: 'github-actions' });
  assert.equal(doc.doc.claims[key].attempts, 1);
  doc = updateClaimDoc(doc.doc, {
    date, slot: 1, status: 'released', at, by: 'github-actions', extra: { tried: ['verge.com/a'] }
  });
  assert.equal(doc.ok, true);
  assert.equal(doc.doc.claims[key].attempts, 1);
  assert.deepEqual(doc.doc.claims[key].tried, ['verge.com/a']);

  const retry = evaluateClaim({ claimsDoc: doc.doc, history: { posted: [] }, date, slot: 1 });
  assert.equal(retry.ok, true);
  assert.equal(retry.retry, true);
  assert.deepEqual(retry.tried, ['verge.com/a']);

  doc = updateClaimDoc(doc.doc, { date, slot: 1, status: 'claimed', at, by: 'github-actions' });
  assert.equal(doc.doc.claims[key].attempts, 2);
  assert.deepEqual(doc.doc.claims[key].tried, ['verge.com/a']);
  doc = updateClaimDoc(doc.doc, {
    date, slot: 1, status: 'released', at, by: 'github-actions',
    extra: { tried: mergeTried(['verge.com/a'], ['wired.com/b']) }
  });
  const stopped = evaluateClaim({ claimsDoc: doc.doc, history: { posted: [] }, date, slot: 1 });
  assert.equal(stopped.ok, false);
  assert.match(stopped.reason, /not retrying/);
  assert.equal(MAX_SLOT_ATTEMPTS, 2);

  const manual = evaluateClaim({ claimsDoc: doc.doc, history: { posted: [] }, date, slot: 1, manual: true });
  assert.equal(manual.ok, true);
  assert.equal(manual.retry, true);

  const posted = updateClaimDoc(doc.doc, {
    date, slot: 1, status: 'posted', at, by: 'github-actions', extra: { slug: 'already-live', image: 'a.png' }
  });
  assert.equal(posted.ok, true);
  assert.equal(posted.doc.claims[key].slug, 'already-live');
  assert.equal(posted.doc.claims[key].attempts, 2);
  assert.deepEqual(posted.doc.claims[key].tried, []);
  const blocked = evaluateClaim({ claimsDoc: posted.doc, history: { posted: [] }, date, slot: 1, manual: true });
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /posted/);
  assert.equal(updateClaimDoc(posted.doc, { date, slot: 1, status: 'released', at }).ok, false);
});

test('a released row that predates attempt counts still gets one retry', () => {
  const legacy = { claims: { [claimKey(date, 1)]: { status: 'released', at, by: 'github-actions' } } };
  const gate = evaluateClaim({ claimsDoc: legacy, history: { posted: [] }, date, slot: 1 });
  assert.equal(gate.ok, true);
  assert.equal(gate.retry, true);
  assert.equal(gate.attempts, 1);
  const claimed = updateClaimDoc(legacy, { date, slot: 1, status: 'claimed', at, by: 'github-actions' });
  assert.equal(claimed.doc.claims[claimKey(date, 1)].attempts, 2);
});

test('reclaiming a stuck claim does not spend the retry, and history still blocks a released slot', () => {
  const stuck = updateClaimDoc({ claims: {} }, { date, slot: 1, status: 'claimed', at, by: 'github-actions' });
  const again = updateClaimDoc(stuck.doc, { date, slot: 1, status: 'claimed', at, by: 'github-actions', takeOver: true });
  assert.equal(again.ok, true);
  assert.equal(again.doc.claims[claimKey(date, 1)].attempts, 1);
  const history = { posted: [{ date, slot: 1, headline: 'Already up' }] };
  const released = updateClaimDoc({ claims: {} }, { date, slot: 1, status: 'released', at, by: 'github-actions' });
  const gate = evaluateClaim({ claimsDoc: released.doc, history, date, slot: 1, manual: true });
  assert.equal(gate.ok, false);
  assert.match(gate.reason, /history/);
});

test('an article that never goes live releases the claim and drops that slot from history', () => {
  const claimed = updateClaimDoc({ claims: {} }, { date, slot: 1, status: 'claimed', at, by: 'github-actions' });
  const history = {
    posted: [
      { date, slot: 1, headline: 'Not live yet', canonUrl: 'https://example.com/a' },
      { date, slot: 2, headline: 'Other slot' }
    ],
    rankings: { '2026-10-07': [1] }
  };
  const released = unpublishedSlotUpdate(claimed.doc, history, {
    date, slot: 1, at, tried: ['https://example.com/a']
  });
  assert.equal(released.ok, true);
  assert.equal(released.claims.claims[claimKey(date, 1)].status, 'released');
  assert.deepEqual(released.claims.claims[claimKey(date, 1)].tried, ['https://example.com/a']);
  assert.equal(released.history.posted.length, 1);
  assert.equal(released.history.posted[0].slot, 2);
  assert.deepEqual(released.history.rankings, { '2026-10-07': [1] });
  const gate = evaluateClaim({ claimsDoc: released.claims, history: released.history, date, slot: 1 });
  assert.equal(gate.ok, true);
  assert.equal(gate.retry, true);
  assert.deepEqual(gate.tried, ['https://example.com/a']);
  const posted = updateClaimDoc(claimed.doc, { date, slot: 1, status: 'posted', at });
  const refused = unpublishedSlotUpdate(posted.doc, history, { date, slot: 1, at, tried: [] });
  assert.equal(refused.ok, false);
});

test('take_over can reclaim a claimed slot but not a posted one', () => {
  const claimed = updateClaimDoc({ claims: {} }, { date, slot: 1, status: 'claimed', at, by: 'github-actions' });
  const takeover = evaluateClaim({ claimsDoc: claimed.doc, history: { posted: [] }, date, slot: 1, takeOver: true });
  assert.equal(takeover.ok, true);
  const rewritten = updateClaimDoc(claimed.doc, { date, slot: 1, status: 'claimed', at, by: 'github-actions', takeOver: true });
  assert.equal(rewritten.ok, true);
  const posted = updateClaimDoc(claimed.doc, { date, slot: 1, status: 'posted', at });
  const no = evaluateClaim({ claimsDoc: posted.doc, history: { posted: [] }, date, slot: 1, takeOver: true });
  assert.equal(no.ok, false);
});
