// GitHub Actions cron is UTC. America/New_York is UTC-4 (EDT) or UTC-5 (EST).
// The workflow fires both offsets; this module keeps the run whose local hour is 8 or 17.

const SLOT_HOURS = { 8: 1, 17: 2 };

// UTC hours registered in autopilot.yml. Both DST offsets for 8:00 and 17:00 ET.
const SCHEDULED_UTC_HOURS = [12, 13, 21, 22];

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
 * schedule: only when America/New_York hour is 8 (slot 1) or 17 (slot 2).
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
      reason: `America/New_York hour is ${et.hour} on ${et.date}, not 8 (slot 1) or 17 (slot 2). Skipping so the other DST cron offset does not post.`
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

module.exports = { SLOT_HOURS, SCHEDULED_UTC_HOURS, etParts, slotForEtHour, decideRun };
