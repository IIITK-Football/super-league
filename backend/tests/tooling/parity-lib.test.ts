// Group: tooling. The SL-032 parity runner's verdicts: an active operation passes only when every check of it passes,
// an operation never exercised is a gap (never a pass), a check against an operation outside the register is flagged,
// and the run targets only this repository's local stack.
import { describe, expect, it } from 'vitest';
import { ACTIVE_OPERATIONS, createReport, localProblems, png, summarize } from '../../../scripts/parity/lib.mjs';

const everyPass = () => {
  const r = createReport();
  for (const [group, ops] of Object.entries(ACTIVE_OPERATIONS)) for (const op of ops as string[]) r.check(group, op, 'ok', true);
  return r;
};

describe('parity verdicts', () => {
  it('passes only when every active operation of every group passed', () => {
    expect(everyPass().summary().passed).toBe(true);
  });

  it('reports a failed check as a failed group', () => {
    const r = everyPass();
    r.check('G6', 'POST /admin/matches', 'refusal stored a row', false);
    const s = r.summary();
    expect(s.passed).toBe(false);
    expect((s.groups as Record<string, unknown>).G6).toMatchObject({ status: 'fail', operations: { 'POST /admin/matches': 'fail' } });
  });

  it('reports an operation never exercised as a gap, never a pass', () => {
    const checks = everyPass().checks.filter((c: { operation: string }) => c.operation !== 'POST /profile/player-portrait');
    const s = summarize(checks);
    expect(s.passed).toBe(false);
    expect((s.groups as Record<string, unknown>).G8).toMatchObject({ status: 'gap', operations: { 'POST /profile/player-portrait': 'gap' } });
  });

  it('flags a check against an operation outside the register', () => {
    const r = everyPass();
    r.check('G1', 'GET /wc/teams', 'archive', true);
    expect(r.summary()).toMatchObject({ passed: false, unknownOperations: ['G1 GET /wc/teams'] });
  });

  it('keeps the archive and HLS out of the active register', () => {
    const all = Object.values(ACTIVE_OPERATIONS).flat().join(' ');
    expect(all).not.toMatch(/\/wc\/(teams|players|leaderboard|predictions)|\/media\//);
  });
});

describe('parity targets and fixtures', () => {
  it('accepts only the local stack', () => {
    const local = { API_URL: 'http://127.0.0.1:54321', DB_URL: 'postgresql://x@127.0.0.1:54322/postgres' };
    expect(localProblems(local, 'SUPABASE_URL=http://127.0.0.1:54321\n')).toEqual([]);
    expect(localProblems({ ...local, API_URL: 'https://yecozsiccsfwphlmxozt.supabase.co' }, 'SUPABASE_URL=http://127.0.0.1:54321\n')).toHaveLength(1);
  });

  it('builds a valid PNG of the requested size', () => {
    const b = png(500);
    expect([...b.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(b.readUInt32BE(16)).toBe(500);
    expect(b.readUInt32BE(20)).toBe(500);
  });
});
