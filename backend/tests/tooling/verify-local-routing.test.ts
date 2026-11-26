// Group: tooling. The local routing evidence script runs only against THIS repository's local Supabase stack: both the
// CLI status and the Worker's own .dev.vars must name it, or it refuses before starting anything.
import { describe, expect, it } from 'vitest';
import { localProblems } from '../../../scripts/verify-local-routing.mjs';

const local = { API_URL: 'http://127.0.0.1:54321', DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' };
const devVars = 'SUPABASE_URL=http://127.0.0.1:54321\nSL_ENVIRONMENT=local\n';

describe('verify-local-routing target guard', () => {
  it('accepts only the local stack', () => {
    expect(localProblems(local, devVars)).toEqual([]);
  });

  it('refuses a hosted API, another database port, or a Worker pointed elsewhere', () => {
    expect(localProblems({ ...local, API_URL: 'https://yecozsiccsfwphlmxozt.supabase.co' }, devVars).join()).toMatch(/not the local stack/);
    expect(localProblems({ ...local, DB_URL: 'postgresql://x@127.0.0.1:54399/postgres' }, devVars).join()).toMatch(/54322/);
    expect(localProblems(local, 'SUPABASE_URL=https://obkxfepdpdufxawhzaen.supabase.co\n').join()).toMatch(/dev\.vars/);
    expect(localProblems(null, '')).toHaveLength(3);
  });
});
