// Group: tooling. scripts/sql/reconcile-league-points.sql, run on the LOCAL database (127.0.0.1:54322) inside a
// transaction that is always rolled back. user_profiles.points no longer exists locally (20261123000000 removed it), so
// the test adds it back, as a project before that migration has it, with fixtures: an account carrying all of its
// World Cup group-stage points in its league total, one carrying part of them (regraded later), one already correct,
// and, separately, one whose difference the group stage does not explain. The script corrects exactly the explained
// accounts, lists each correction, changes nothing on a second run, and stops with nothing changed on an unexplained one.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const script = readFileSync(join(__dirname, '../../../scripts/sql/reconcile-league-points.sql'), 'utf8');
// The script's own transaction is replaced by the test's, which always rolls back.
const body = script.replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '');

const U = (n: number) => `e9000000-0000-4000-8000-00000000000${n}`;
const setup = (extra = '') => `
BEGIN;
ALTER TABLE public.user_profiles ADD COLUMN points integer DEFAULT 0;
-- Every other account already holds exactly its graded league points.
UPDATE public.user_profiles u SET points = COALESCE((SELECT sum(COALESCE(p.points_awarded, 0)) FROM public.predictions p WHERE p.user_id = u.id), 0);
INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
SELECT ('e9000000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'authenticated', 'lp.check' || n || '@iiitkottayam.ac.in', '', now(), now(), now()
FROM generate_series(1, 4) n;
-- League predictions worth 200 for accounts 1-4, on one seeded match.
INSERT INTO public.predictions (user_id, match_id, predicted_home_score, predicted_away_score, points_awarded, status)
SELECT ('e9000000-0000-4000-8000-00000000000' || n)::uuid, (SELECT id FROM public.matches ORDER BY id LIMIT 1), 1, 0, 200, 'graded'
FROM generate_series(1, 4) n;
-- 1: all 100 group points added (graded 10 June); 2: 40 of its 170 (graded 13 June); 3: correct.
INSERT INTO public.wc_group_predictions (user_id, group_name, predicted_1st_place, predicted_2nd_place, predicted_3rd_place, predicted_4th_place, points_awarded, updated_at)
SELECT f.u::uuid, f.g, t[1], t[2], t[3], t[4], f.pts, f.at::timestamptz
FROM (VALUES ('${U(1)}', 'A', 100, '2026-06-10 12:00+05:30'), ('${U(2)}', 'B', 170, '2026-06-13 20:00+05:30')) f(u, g, pts, at),
     LATERAL (SELECT array_agg(id ORDER BY id) AS t FROM (SELECT id FROM public.wc_teams ORDER BY id LIMIT 4) x) teams(t);
UPDATE public.user_profiles SET points = 300 WHERE id = '${U(1)}';
UPDATE public.user_profiles SET points = 240 WHERE id = '${U(2)}';
UPDATE public.user_profiles SET points = 200 WHERE id IN ('${U(3)}', '${U(4)}');
${extra}
`;
const totals = `SELECT 'TOTALS ' || string_agg(right(id::text, 1) || '=' || points, ',' ORDER BY id) FROM public.user_profiles WHERE id::text LIKE 'e9000000%';`;

function run(sql: string) {
  return spawnSync('psql', [LOCAL_DB, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
}

describe('reconcile-league-points.sql', () => {
  it('corrects only accounts whose excess is World Cup group-stage points, lists them, and is idempotent', () => {
    const r = run(`${setup()}
${body}
${totals}
DROP TABLE _league_points_corrections;
${body}
${totals}
ROLLBACK;`);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/League points reconciliation: 2 account\(s\) corrected/);
    expect(r.stdout).toMatch(new RegExp(`${U(1)}\\|300\\|200\\|100`));
    expect(r.stdout).toMatch(new RegExp(`${U(2)}\\|240\\|200\\|40`));
    expect(r.stdout).not.toMatch(new RegExp(U(3)));
    expect(r.stdout.match(/TOTALS 1=200,2=200,3=200,4=200/g)).toHaveLength(2);
    expect(r.stderr).toMatch(/League points reconciliation: 0 account\(s\) corrected/); // the second run
  });

  it('stops with nothing changed when a difference is not explained by the group stage', () => {
    // 4: 50 too high with no group-stage points; also 1 stays uncorrected because the whole run stops.
    const r = run(`${setup(`UPDATE public.user_profiles SET points = 250 WHERE id = '${U(4)}';`)}
${body}
ROLLBACK;`);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/1 account\(s\) differ in a way the World Cup group-stage addition does not explain\. Nothing was changed\./);
  });

  it('touches only user_profiles.points and runs in one transaction', () => {
    const code = script.replace(/--.*$/gm, '');
    expect(code.trim().startsWith('BEGIN;')).toBe(true);
    expect(code.trim().endsWith('COMMIT;')).toBe(true);
    expect(code.match(/\bUPDATE\s+public\.\w+/g)).toEqual(['UPDATE public.user_profiles']);
    expect(code).toMatch(/SET points = c\.new_points/);
    const writes = code.replace(/ON COMMIT DROP/g, ''); // the temporary list removes itself at commit
    for (const w of ['DELETE', 'TRUNCATE', 'DROP', 'ALTER', 'INSERT', 'GRANT']) expect(writes, w).not.toMatch(new RegExp(`\\b${w}\\b`));
  });
});
