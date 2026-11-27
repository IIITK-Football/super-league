// Match clock helpers for the scorer console. The server stores the clock as a start time plus the minutes played
// before it (timer_calibration); the minute on screen is computed from them.

// A clock still running past this is almost always one left on after the game.
export const RUNAWAY_MINUTE = 130;
// The server keeps event minutes up to 150 (parseMinute).
export const MAX_MINUTE = 150;

// Minutes played now: elapsed since the start plus the calibration, or the stored minute when stopped.
export function clockMinute(match, now = Date.now()) {
  if (!match) return null;
  if (match.timer_start_time) {
    const start = new Date(match.timer_start_time).getTime();
    if (!Number.isNaN(start)) return Math.max(0, Math.floor((now - start) / 60000)) + (match.timer_calibration || 0);
  }
  const stored = parseInt(match.minute, 10);
  return Number.isNaN(stored) ? (match.timer_calibration ?? null) : stored;
}

// A running stint that began before 45 is still the first half, so 47 reads 45+2. Paused clocks cannot tell.
export const inFirstHalf = (match) => Boolean(match?.timer_start_time) && (match.timer_calibration || 0) < 45;

// 93 -> "90+3", 47 in the first half -> "45+2", otherwise the minute itself.
export function minuteLabel(minute, firstHalf = false) {
  if (minute === null || minute === undefined || Number.isNaN(minute)) return '';
  if (firstHalf && minute > 45 && minute < 90) return `45+${minute - 45}`;
  if (minute > 90) return `90+${minute - 90}`;
  return String(minute);
}

// The minute sent with an event, in the form the server parses (minute plus added time, at most 30 added).
export function eventMinute(minute, firstHalf = false) {
  if (minute === null || minute === undefined || Number.isNaN(minute)) return null;
  const label = minuteLabel(minute, firstHalf);
  const added = Number(label.split('+')[1] ?? 0);
  return added > 30 ? String(minute) : label;
}

// An event's minute as recorded: 90 with 3 added reads 90+3.
export const recordedMinute = (event) => (event.minute === null || event.minute === undefined
  ? '?'
  : event.added_minute ? `${event.minute}+${event.added_minute}` : String(event.minute));

// The total minute of a recorded event, for the minute stepper.
export const totalMinute = (event) => (event.minute === null || event.minute === undefined ? null : event.minute + (event.added_minute || 0));
