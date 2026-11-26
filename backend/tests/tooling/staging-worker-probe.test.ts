// Group: tooling. The read-only staging Worker probe: its timing summary (median and p95 of the samples) and its
// reading of the Worker's Server-Timing header. Site and token guards are shared with the staging media check.
import { describe, expect, it } from 'vitest';
import { parseServerTiming, percentile, summarize } from '../../../scripts/staging-worker-probe.mjs';

describe('staging worker probe', () => {
  it('computes nearest-rank percentiles', () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(values, 50)).toBe(10);
    expect(percentile(values, 95)).toBe(19);
    expect(percentile([], 50)).toBeNull();
  });

  it('reads total, database time and rounds from Server-Timing', () => {
    expect(parseServerTiming('total;dur=40.5, db;dur=12.3;desc="rounds=3 calls=8"')).toEqual({ total: 40.5, db: 12.3, rounds: 3 });
    expect(parseServerTiming(null)).toEqual({ total: null, db: null, rounds: null });
  });

  it('summarizes samples, counting only successful answers as ok', () => {
    const s = summarize([
      { status: 200, wall: 100, total: 40, db: 20, rounds: 3 },
      { status: 200, wall: 120, total: 50, db: 25, rounds: 2 },
      { status: 503, wall: 10, total: null, db: null, rounds: null },
    ]);
    expect(s).toMatchObject({ samples: 3, ok: 2, maxRounds: 3, wallMs: { median: 100, p95: 120 }, workerTotalMs: { median: 40, p95: 50 } });
  });
});
