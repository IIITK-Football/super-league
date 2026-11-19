// Group: tooling. scripts/sql/clear-invalid-jersey-numbers.sql, run on the LOCAL database (127.0.0.1:54322) inside a
// transaction that is always rolled back. The legacy shape it corrects no longer exists locally (players.team_id and
// players.jersey_number moved to roster places; team_members was retired), so the test recreates it, as a project
// before 20261124000000 has it, with fixtures: out-of-range numbers (100, 600) and numbers shared on a team (two players
// of one team, two members of one registration) are cleared and listed; valid numbers (0, 99), the same number on
// different teams and unset numbers are kept; a second run changes nothing.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const script = readFileSync(join(__dirname, '../../../scripts/sql/clear-invalid-jersey-numbers.sql'), 'utf8');
const body = script.replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '');
const P = (n: number) => `e8000000-0000-4000-8000-00000000000${n}`;
const M = (n: number) => `e8100000-0000-4000-8000-00000000000${n}`;
const T1 = 'e8200000-0000-4000-8000-000000000001';
const T2 = 'e8200000-0000-4000-8000-000000000002';
const R1 = 'e8300000-0000-4000-8000-000000000001';
const R2 = 'e8300000-0000-4000-8000-000000000002';

describe('clear-invalid-jersey-numbers.sql', () => {
  it('clears out-of-range and shared numbers only, lists them, and changes nothing on a second run', () => {
    const numbers = `SELECT 'NUMBERS ' || (SELECT string_agg('p' || right(id::text, 1) || '=' || COALESCE(jersey_number::text, 'unset'), ',' ORDER BY id) FROM public.players WHERE id::text LIKE 'e8000000%')
                 || ' ' || (SELECT string_agg('m' || right(id::text, 1) || '=' || COALESCE(jersey_number::text, 'unset'), ',' ORDER BY id) FROM public.team_members);`;
    const sql = `BEGIN;
ALTER TABLE public.players ADD COLUMN team_id uuid, ADD COLUMN jersey_number integer;
CREATE TABLE public.team_members (id uuid PRIMARY KEY, registration_id uuid, jersey_number integer);
INSERT INTO public.players (id, first_name, last_name, team_id, jersey_number) VALUES
  ('${P(1)}', 'J', 'Hundred', '${T1}', 100), ('${P(2)}', 'J', 'SixHundred', NULL, 600),
  ('${P(3)}', 'J', 'Zero', '${T1}', 0), ('${P(4)}', 'J', 'NinetyNine', '${T1}', 99), ('${P(5)}', 'J', 'Unset', '${T1}', NULL),
  ('${P(6)}', 'J', 'SharedA', '${T1}', 7), ('${P(7)}', 'J', 'SharedB', '${T1}', 7), ('${P(8)}', 'J', 'OtherTeam', '${T2}', 7);
INSERT INTO public.team_members (id, registration_id, jersey_number) VALUES
  ('${M(1)}', '${R1}', 13), ('${M(2)}', '${R1}', 13), ('${M(3)}', '${R1}', 14), ('${M(4)}', '${R2}', 13), ('${M(5)}', '${R2}', 101);
${body}
${numbers}
DROP TABLE _jersey_corrections;
${body}
${numbers}
ROLLBACK;`;
    const r = spawnSync('psql', [LOCAL_DB, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/Jersey numbers cleared: 7/);
    expect(r.stderr).toMatch(/Jersey numbers cleared: 0/);
    expect(r.stdout).toMatch(new RegExp(`player\\|${P(1)}\\|100\\|out of range`));
    expect(r.stdout).toMatch(new RegExp(`player\\|${P(6)}\\|7\\|shared on the team`));
    expect(r.stdout).toMatch(new RegExp(`team member\\|${M(2)}\\|13\\|shared on the team`));
    expect(r.stdout).toMatch(new RegExp(`team member\\|${M(5)}\\|101\\|out of range`));
    const expected = 'NUMBERS p1=unset,p2=unset,p3=0,p4=99,p5=unset,p6=unset,p7=unset,p8=7 m1=unset,m2=unset,m3=14,m4=13,m5=unset';
    expect(r.stdout.split('\n').filter((l) => l.startsWith('NUMBERS'))).toEqual([expected, expected]);
  });

  it('touches only jersey numbers and runs in one transaction', () => {
    const code = script.replace(/--.*$/gm, '');
    expect(code.trim().startsWith('BEGIN;')).toBe(true);
    expect(code.trim().endsWith('COMMIT;')).toBe(true);
    expect(code.match(/\bUPDATE\s+public\.\w+/g)).toEqual(['UPDATE public.players', 'UPDATE public.team_members']);
    expect(code.match(/SET jersey_number = NULL/g)).toHaveLength(2);
    const writes = code.replace(/ON COMMIT DROP/g, '');
    for (const w of ['DELETE', 'TRUNCATE', 'DROP', 'ALTER', 'INSERT', 'GRANT']) expect(writes, w).not.toMatch(new RegExp(`\\b${w}\\b`));
  });
});
