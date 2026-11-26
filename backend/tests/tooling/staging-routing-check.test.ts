// Group: tooling. The staging routing check's verdicts: each routing rule passes only for the exact answers the
// same-origin /api contract promises (release pair, forwarded bearer, stable errors, no-store).
import { describe, expect, it } from 'vitest';
import { judge } from '../../../scripts/staging-routing-check.mjs';

const ok = (status: number, body: unknown = { success: true }) => ({ status, body, type: 'application/json', cache: 'no-store' });
const answers = () => ({
  version: { status: 200, body: { commit: 'abcdef1' }, type: 'application/json', cache: null },
  health: ok(200, { environment: 'staging', commit: 'abcdef1' }),
  standings: ok(200),
  history: ok(200),
  historyAnon: ok(401, { success: false }),
  write: ok(403, { success: false }),
  writeAnon: ok(401, { success: false }),
  errors: [ok(404, { success: false }), ok(400, { success: false }), ok(404, { success: false })],
});

describe('staging routing verdicts', () => {
  it('passes the promised answers', () => {
    expect(judge(answers()).every((c: { pass: boolean }) => c.pass)).toBe(true);
  });

  it('fails a dropped bearer, a cacheable answer, an HTML error and a non-staging Worker', () => {
    const fails = (mutate: (a: ReturnType<typeof answers>) => void) => {
      const a = answers();
      mutate(a);
      return judge(a).filter((c: { pass: boolean }) => !c.pass).map((c: { name: string }) => c.name);
    };
    expect(fails((a) => { a.history = ok(401, { success: false }); }).join()).toMatch(/bearer/);
    expect(fails((a) => { a.standings = { ...ok(200), cache: 'public, max-age=60' }; }).join()).toMatch(/no-store/);
    expect(fails((a) => { a.errors[0] = { ...ok(404, null), type: 'text/html' }; }).join()).toMatch(/stable JSON/);
    expect(fails((a) => { a.health = ok(200, { environment: 'production', commit: 'abcdef1' }); }).join()).toMatch(/release/);
  });
});
