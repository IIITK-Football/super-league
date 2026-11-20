// Group: tooling. The R10 UI walkthrough script refuses anything but this repository's local stack, never prints or
// writes a key, and removes what it creates, so it can be rerun safely. (The walkthrough itself needs a browser and the
// running app; it is run by hand or by the agent and recorded in the item's walkthrough.)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = readFileSync(join(__dirname, '../../../scripts/ui-walkthrough/roles.mjs'), 'utf8');

describe('ui walkthrough script', () => {
  it('refuses any target but the local stack on 127.0.0.1:54321', () => {
    expect(script).toMatch(/API_URL !== 'http:\/\/127\.0\.0\.1:54321'/);
    expect(script).not.toMatch(/supabase\.co/);
  });
  it('never prints keys', () => {
    expect(script).not.toMatch(/console\.log\([^)]*(SECRET_KEY|PUBLISHABLE_KEY|access_token)/);
  });
  it('cleans up the accounts and rows it creates, even after a failure', () => {
    expect(script).toMatch(/finally \{[\s\S]*deleteUser[\s\S]*\.delete\(\)/);
  });
  it('covers the dictator, scorer, captain and normal-user flows', () => {
    for (const step of ['Captains', 'Scorers', 'Access control', 'Live Matches only', 'Captain edits team name', 'normal user']) expect(script).toContain(step);
  });
});
