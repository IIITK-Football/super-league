// Group: fantasy. The division fantasy leaderboard never reads profile emails (SL-025: the email column is not readable
// through the Data API) and never derives a display name from an email; the fallback is a neutral Fan_ label.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const route = readFileSync(join(__dirname, '../../app/api/predictions/leaderboard/route.ts'), 'utf8');

describe('fantasy leaderboard privacy', () => {
  it('selects no email column', () => {
    const selects = [...route.matchAll(/\.select\('([^']*)'\)/g)].map((m) => m[1]);
    expect(selects.length).toBeGreaterThan(0);
    for (const cols of selects) expect(cols).not.toMatch(/email/);
  });

  it('builds display names from the nickname or real name, then a neutral fallback', () => {
    expect(route).toMatch(/username: p\.nickname \|\| p\.real_name \|\| `Fan_\$\{p\.id\.substring\(0, 5\)\}`/);
    expect(route).not.toMatch(/email\?\.split|email\.split/);
  });
});
