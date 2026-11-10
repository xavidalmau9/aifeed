const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decideRun, etParts, SCHEDULED_UTC_HOURS, RETRY_UTC_HOURS, RETRY_MINUTE, GRACE_UTC_HOURS } = require('../lib/schedule');

function at(iso) {
  return decideRun({ now: new Date(iso), eventName: 'schedule', slotInput: 'auto' });
}

test('scheduled UTC hours cover both DST offsets for 8:00 and 17:00 ET', () => {
  assert.deepEqual(SCHEDULED_UTC_HOURS, [12, 13, 21, 22]);
  const yaml = fs.readFileSync(path.join(__dirname, '../../../.github/workflows/autopilot.yml'), 'utf8');
  for (const hour of SCHEDULED_UTC_HOURS) {
    assert.match(yaml, new RegExp("cron: '3 " + hour + " \\* \\* \\*'"));
  }
  assert.match(yaml, /group: .*\|\| 'aifeed-autopilot'/);
  assert.deepEqual(RETRY_UTC_HOURS, [12, 13, 21, 22]);
  assert.equal(RETRY_MINUTE, 48);
  for (const hour of RETRY_UTC_HOURS) {
    assert.match(yaml, new RegExp("cron: '" + RETRY_MINUTE + ' ' + hour + " \\* \\* \\*'"));
  }
  assert.deepEqual(GRACE_UTC_HOURS, [14, 23]);
  for (const hour of GRACE_UTC_HOURS) {
    assert.match(yaml, new RegExp("cron: '3 " + hour + " \\* \\* \\*'"));
  }
});

test('the pipeline retries a released slot and still refuses a second post', () => {
  const pipeline = fs.readFileSync(path.join(__dirname, '../pipeline.js'), 'utf8');
  assert.match(pipeline, /mergeTried\(gate\.tried, attemptedKeys\)/);
  assert.match(pipeline, /prepareRetryPool/);
  assert.match(pipeline, /manual: env\.EVENT_NAME === 'workflow_dispatch'/);
  assert.match(pipeline, /fallbackSalt: decision\.date \+ ':' \+ decision\.slot/);
  assert.match(pipeline, /contentCommitted/);
});

test('8:00 and 17:00 America/New_York run the right slot in EDT and EST', () => {
  const edtMorning = at('2026-07-15T12:00:00Z');
  assert.equal(edtMorning.run, true);
  assert.equal(edtMorning.slot, 1);
  assert.equal(edtMorning.date, '2026-07-15');
  assert.equal(etParts(new Date('2026-07-15T12:00:00Z')).hour, 8);

  // 13:00 UTC in EDT is 9:00 ET: grace/backup run for slot 1 (the claim lock stops a second post).
  const edtBackup = at('2026-07-15T13:00:00Z');
  assert.equal(edtBackup.run, true);
  assert.equal(edtBackup.slot, 1);
  assert.equal(edtBackup.hour, 9);

  const estMorningOff = at('2026-01-15T12:00:00Z');
  assert.equal(estMorningOff.run, false);
  assert.equal(estMorningOff.hour, 7);

  const estMorning = at('2026-01-15T13:00:00Z');
  assert.equal(estMorning.run, true);
  assert.equal(estMorning.slot, 1);
  assert.equal(estMorning.hour, 8);

  const edtEvening = at('2026-07-15T21:00:00Z');
  assert.equal(edtEvening.run, true);
  assert.equal(edtEvening.slot, 2);
  assert.equal(edtEvening.hour, 17);

  assert.equal(at('2026-07-15T22:00:00Z').slot, 2); // 18:00 EDT grace/backup
  assert.equal(at('2026-01-15T21:00:00Z').run, false); // 16:00 EST

  const estEvening = at('2026-01-15T22:00:00Z');
  assert.equal(estEvening.run, true);
  assert.equal(estEvening.slot, 2);
  assert.equal(estEvening.hour, 17);
});

test('DST transition weekends follow America/New_York, not a fixed offset', () => {
  // 2026-03-08 is the second Sunday in March (EDT starts). 2026-11-01 is the first Sunday in November (EST returns).
  assert.equal(at('2026-03-07T13:00:00Z').slot, 1); // still EST, 8:00
  assert.equal(at('2026-03-08T12:00:00Z').slot, 1); // EDT, 8:00
  assert.equal(at('2026-11-01T12:00:00Z').run, false); // EST, 7:00
  assert.equal(at('2026-11-01T13:00:00Z').slot, 1); // EST, 8:00
});

test('the :48 retry is inside the slot window in both DST offsets', () => {
  assert.equal(at('2026-07-15T12:48:00Z').slot, 1); // 8:48 EDT
  assert.equal(at('2026-01-15T12:48:00Z').run, false); // 7:48 EST
  const estMorningRetry = at('2026-01-15T13:48:00Z');
  assert.equal(estMorningRetry.run, true);
  assert.equal(estMorningRetry.slot, 1);
  assert.equal(estMorningRetry.hour, 8);
  assert.equal(at('2026-07-15T13:48:00Z').slot, 1); // 9:48 EDT, still the grace hour

  assert.equal(at('2026-07-15T21:48:00Z').slot, 2); // 17:48 EDT
  assert.equal(at('2026-01-15T21:48:00Z').run, false); // 16:48 EST
  const estEveningRetry = at('2026-01-15T22:48:00Z');
  assert.equal(estEveningRetry.run, true);
  assert.equal(estEveningRetry.slot, 2);
  assert.equal(estEveningRetry.hour, 17);
  assert.equal(at('2026-07-15T22:48:00Z').slot, 2); // 18:48 EDT grace

  // EST grace hour. The other offset (10:00 / 19:00 EDT) stays outside the gate.
  assert.equal(at('2026-01-15T14:03:00Z').slot, 1); // 9:03 EST
  assert.equal(at('2026-07-15T14:03:00Z').run, false); // 10:03 EDT
  assert.equal(at('2026-01-15T23:03:00Z').slot, 2); // 18:03 EST
  assert.equal(at('2026-07-15T23:03:00Z').run, false); // 19:03 EDT
});

test('a scheduled run delayed past the hour still posts its slot, but not later', () => {
  assert.equal(at('2026-07-15T13:25:00Z').slot, 1); // 8:00 EDT run delayed to 9:25
  assert.equal(at('2026-01-15T14:40:00Z').slot, 1); // 8:00 EST run delayed to 9:40
  assert.equal(at('2026-01-15T15:05:00Z').run, false); // 10:05 EST
  assert.equal(at('2026-07-15T22:50:00Z').slot, 2); // 17:00 EDT run delayed to 18:50
  assert.equal(at('2026-07-15T23:01:00Z').run, false); // 19:01 EDT
  assert.equal(at('2026-07-15T15:00:00Z').run, false); // 11:00 EDT
});

test('workflow_dispatch can force a slot outside 8:00 and 17:00, and auto still gates', () => {
  const noon = new Date('2026-07-15T16:00:00Z'); // 12:00 EDT
  const forced = decideRun({ now: noon, eventName: 'workflow_dispatch', slotInput: '2' });
  assert.equal(forced.run, true);
  assert.equal(forced.slot, 2);
  const auto = decideRun({ now: noon, eventName: 'workflow_dispatch', slotInput: 'auto' });
  assert.equal(auto.run, false);
  const scheduledForceIgnored = decideRun({ now: noon, eventName: 'schedule', slotInput: '1' });
  assert.equal(scheduledForceIgnored.run, false);
});
