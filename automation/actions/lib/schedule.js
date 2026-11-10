// GitHub Actions cron is UTC. America/New_York is UTC-4 (EDT) or UTC-5 (EST).
// The workflow fires both offsets; this module keeps the run whose local hour is 8-9 (slot 1) or 17-18 (slot 2).

// GitHub delays scheduled runs at busy times (top of the hour), sometimes past the hour.
// Hour 9 / 18 ET is a grace window so a late 8:00 / 17:00 run still posts. The slot claim and
// history.json keep it to one post per slot. A released claim (the run gave up before publishing)
// is claimed again by the :48 retry. Posted slots and history entries are not retried.
const SLOT_HOURS = { 8: 1, 9: 1, 17: 2, 18: 2 };

// UTC hours registered in autopilot.yml. Both DST offsets for 8:00 and 17:00 ET.
const SCHEDULED_UTC_HOURS = [12, 13, 21, 22];
// ~45 minutes after each primary. Same UTC hours, minute 48.
// 12:48 is 8:48 EDT (7:48 EST, hour gate skips). 13:48 is 8:48 EST (9:48 EDT, still inside the grace hour).
const RETRY_UTC_HOURS = [12, 13, 21, 22];
const RETRY_MINUTE = 48;
// 14:03 UTC is 9:03 EST (10:03 EDT, hour gate skips). 23:03 UTC is 18:03 EST (19:03 EDT, skipped).
// This is the EST grace hour. EDT already gets hour 9/18 from the other offset's :03 cron.
const GRACE_UTC_HOURS = [14, 23];

function etParts(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid date');
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
  let hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    hourCycle: 'h23'
  }).format(d));
  if (hour === 24) hour = 0;
  return { date: dateStr, hour };
}

function slotForEtHour(hour) {
  return Object.prototype.hasOwnProperty.call(SLOT_HOURS, hour) ? SLOT_HOURS[hour] : null;
}

/**
 * Decide whether this Actions run should post.
 * schedule: only when America/New_York hour is 8-9 (slot 1) or 17-18 (slot 2); the claim lock stops a second post.
 * workflow_dispatch: an explicit slot 1 or 2 runs at any hour; "auto" uses the same hour gate.
 */
function decideRun({ now = new Date(), eventName = 'schedule', slotInput = 'auto' } = {}) {
  const et = etParts(now);
  const input = slotInput == null || slotInput === '' ? 'auto' : String(slotInput);
  const explicit = input === '1' || input === '2';
  if (eventName === 'workflow_dispatch' && explicit) {
    return {
      run: true,
      slot: Number(input),
      date: et.date,
      hour: et.hour,
      reason: `manual slot ${input} (America/New_York ${et.date} hour ${et.hour})`
    };
  }
  const slot = slotForEtHour(et.hour);
  if (!slot) {
    return {
      run: false,
      slot: null,
      date: et.date,
      hour: et.hour,
      reason: `America/New_York hour is ${et.hour} on ${et.date}, not 8-9 (slot 1) or 17-18 (slot 2). Skipping so the other DST cron offset does not post.`
    };
  }
  return {
    run: true,
    slot,
    date: et.date,
    hour: et.hour,
    reason: `America/New_York ${et.date} ${String(et.hour).padStart(2, '0')}:00 slot ${slot}`
  };
}

module.exports = {
  SLOT_HOURS, SCHEDULED_UTC_HOURS, RETRY_UTC_HOURS, RETRY_MINUTE, GRACE_UTC_HOURS,
  etParts, slotForEtHour, decideRun
};
