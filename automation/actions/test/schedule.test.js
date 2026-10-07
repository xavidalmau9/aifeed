const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decideRun, etParts, SCHEDULED_UTC_HOURS } = require('../lib/schedule');

function at(iso) {
  return decideRun({ now: new Date(iso), eventName: 'schedule', slotInput: 'auto' });
}

test('scheduled UTC hours cover both DST offsets for 8:00 and 17:00 ET', () => {
  assert.deepEqual(SCHEDULED_UTC_HOURS, [12, 13, 21, 22]);
  const yaml = fs.readFileSync(path.join(__dirname, '../../../.github/workflows/autopilot.yml'), 'utf8');
  for (const hour of SCHEDULED_UTC_HOURS) {
    assert.match(yaml, new RegExp("cron: '0 " + hour + " \\* \\* \\*'"));
  }
  assert.match(yaml, /group: .*\|\| 'aifeed-autopilot'/);
});

test('8:00 and 17:00 America/New_York run the right slot in EDT and EST', () => {
  const edtMorning = at('2026-07-15T12:00:00Z');
  assert.equal(edtMorning.run, true);
  assert.equal(edtMorning.slot, 1);
  assert.equal(edtMorning.date, '2026-07-15');
  assert.equal(etParts(new Date('2026-07-15T12:00:00Z')).hour, 8);

  const edtWrongOffset = at('2026-07-15T13:00:00Z');
  assert.equal(edtWrongOffset.run, false);
  assert.equal(edtWrongOffset.hour, 9);

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

  assert.equal(at('2026-07-15T22:00:00Z').run, false);
  assert.equal(at('2026-01-15T21:00:00Z').run, false);

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
