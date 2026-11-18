// Group: tooling. The roster migration rehearsal (scripts/rehearse-rosters.mjs): it applies exactly the migrations
// after the legacy version, starts from the commit before the roster work, and refuses to run without --yes
// because it rebuilds the local database. The rehearsal itself runs as an explicit command (pnpm db:rehearse-rosters --yes).
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
// @ts-ignore plain ESM
import { LEGACY_REF, LEGACY_VERSION, main, newerMigrations } from '../../../scripts/rehearse-rosters.mjs';

const root = join(__dirname, '../../..');

describe('rehearse-rosters', () => {
  it('applies only the migrations after the legacy version, in order', () => {
    expect(newerMigrations(['20261124000000_b.sql', '20261123000000_a.sql', 'README.md', '20261125000000_c.sql'], '20261123000000'))
      .toEqual(['20261124000000_b.sql', '20261125000000_c.sql']);
  });

  it('the legacy version exists, and the roster migrations come after it', () => {
    const files = readdirSync(join(root, 'backend/supabase/migrations'));
    expect(files.some((f: string) => f.startsWith(`${LEGACY_VERSION}_`))).toBe(true);
    expect(newerMigrations(files)).toContain('20261124000000_player_identity_rosters.sql');
  });

  it('starts from a commit, and its fixtures and assertions exist', () => {
    expect(LEGACY_REF).toMatch(/^[0-9a-f]{40}$/);
    for (const f of ['legacy_rosters_fixture.sql', 'legacy_rosters_ambiguous.sql', 'rosters.test.sql']) {
      expect(existsSync(join(root, 'backend/supabase/rehearsal', f)), f).toBe(true);
    }
  });

  it('refuses to run without --yes', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main([])).toBe(2);
    expect(error.mock.calls.join(' ')).toMatch(/--yes/);
    error.mockRestore();
  });
});
