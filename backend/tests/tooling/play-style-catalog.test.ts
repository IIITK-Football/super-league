// Group: tooling. The database's play-style catalog (public.play_style_names(), which the players check uses) is
// exactly the frontend catalog (frontend/src/data/playStyles.js), so a play style chosen in any UI is always accepted
// and nothing outside the catalog can be stored. Reads the LOCAL database (127.0.0.1:54322) only.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
// @ts-ignore plain ESM data module
import { PLAY_STYLES } from '../../../frontend/src/data/playStyles.js';

const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

describe('play-style catalog', () => {
  it('the database and the frontend list the same play styles, in the same order', () => {
    const r = spawnSync('psql', [LOCAL_DB, '-At', '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT unnest(public.play_style_names())'], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const stored = r.stdout.trim().split('\n');
    expect(stored).toEqual(PLAY_STYLES.map((s: { name: string }) => s.name));
    expect(new Set(stored).size).toBe(stored.length);
  });
});
