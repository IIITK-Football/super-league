// Group: match-operations. The scorer clock: minutes from the stored start, stoppage time labels, and event minutes.
import { describe, expect, it } from 'vitest';
import { clockMinute, eventMinute, inFirstHalf, minuteLabel, recordedMinute, totalMinute } from '../clock';

describe('scorer clock', () => {
  it('computes the running minute from the start and calibration, else the stored minute', () => {
    const start = Date.parse('2026-11-26T10:00:00Z');
    expect(clockMinute({ timer_start_time: '2026-11-26T10:00:00Z', timer_calibration: 30 }, start + 12.5 * 60000)).toBe(42);
    expect(clockMinute({ minute: "67'", timer_start_time: null })).toBe(67);
    expect(clockMinute({ minute: 'HT', timer_calibration: 45 })).toBe(45);
    expect(clockMinute(null)).toBeNull();
  });

  it('labels stoppage time', () => {
    expect(minuteLabel(93)).toBe('90+3');
    expect(minuteLabel(47, true)).toBe('45+2');
    expect(minuteLabel(47)).toBe('47');
    expect(minuteLabel(90)).toBe('90');
    expect(minuteLabel(null)).toBe('');
  });

  it('knows the first half only from a running stint that began before 45', () => {
    expect(inFirstHalf({ timer_start_time: 'x', timer_calibration: 0 })).toBe(true);
    expect(inFirstHalf({ timer_start_time: 'x', timer_calibration: 48 })).toBe(false);
    expect(inFirstHalf({ timer_start_time: null, timer_calibration: 0 })).toBe(false);
  });

  it('sends event minutes the server parses, and never more than 30 added', () => {
    expect(eventMinute(20)).toBe('20');
    expect(eventMinute(93)).toBe('90+3');
    expect(eventMinute(47, true)).toBe('45+2');
    expect(eventMinute(125)).toBe('125');
    expect(eventMinute(null)).toBeNull();
  });

  it('reads recorded minutes with added time', () => {
    expect(recordedMinute({ minute: 90, added_minute: 3 })).toBe('90+3');
    expect(recordedMinute({ minute: null })).toBe('?');
    expect(totalMinute({ minute: 90, added_minute: 3 })).toBe(93);
  });
});
