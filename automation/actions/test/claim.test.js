const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateClaim, updateClaimDoc, claimKey, historyHasSlot } = require('../lib/claim');

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
