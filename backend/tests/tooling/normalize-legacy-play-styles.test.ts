// Group: tooling. scripts/sql/normalize-legacy-play-styles.sql, run on the LOCAL database (127.0.0.1:54322) inside a
// transaction that is always rolled back. Players no longer hold play-style lists locally (20261130000004 converted
// them and its check refuses lists), so the test lifts that check inside the transaction and writes legacy rows:
// mapped names, goalkeeper and other leftovers, catalog names (kept, a trailing "+" and case ignored) and no play
// style. It also checks that the script's catalog equals public.play_style_names(), and that an unexpected name or
// a player with several play styles stops it with nothing changed.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const script = readFileSync(join(__dirname, '../../../scripts/sql/normalize-legacy-play-styles.sql'), 'utf8');
const body = script.replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '');
const P = (n: number) => `e7000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const psql = (sql: string) => spawnSync('psql', [LOCAL_DB, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });

const legacy: [number, string | null][] = [
  [1, 'Far Reach (GK)'], [2, 'Long Pass'], [3, 'Power Header'], [4, 'Aerial'], [5, 'Lightning Reflexes'], [6, 'Kick Save'],
  [7, 'Whipped Pass'], [8, 'Professional Yapper'], [9, 'Toe Poke'], [10, 'Snap Shot'], [11, 'Bruiser'],
  [12, 'power shot+'], [13, 'Technical'], [14, null],
];
const setup = (extra = '') => `BEGIN;
ALTER TABLE public.players DROP CONSTRAINT players_attributes_canonical;
INSERT INTO public.players (id, first_name, last_name, attributes) VALUES
${legacy.map(([n, name]) => `  ('${P(n)}', 'Style', 'Check${n}', ${name === null ? `'{"playStyles": []}'` : `jsonb_build_object('playStyles', jsonb_build_array(jsonb_build_object('name', '${name}', 'icon_url', 'https://x/custom.png')))`})`).join(',\n')};
${extra}`;
const styles = `SELECT 'STYLES ' || string_agg(right(id::text, 2) || '=' || COALESCE(attributes -> 'playStyles' -> 0 ->> 'name', '-'), ',' ORDER BY id) FROM public.players WHERE id::text LIKE 'e7000000%';`;

describe('normalize-legacy-play-styles.sql', () => {
  it('maps the agreed names, gives the leftovers their default, keeps catalog names, and is idempotent', () => {
    const r = psql(`${setup()}
${body}
${styles}
DROP TABLE _play_style_catalog, _play_style_map, _play_style_changes;
${body}
${styles}
ROLLBACK;`);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/Play styles converted to catalog names: 11/);
    expect(r.stderr).toMatch(/Play styles converted to catalog names: 0/);
    expect(r.stdout).toMatch(new RegExp(`${P(8)}\\|Professional Yapper\\|Technical`));
    const expected = 'STYLES 01=Far Reach,02=Long Ball Pass,03=Precision Header,04=Aerial Fortress,05=Deflector,06=Deflector,'
      + '07=Technical,08=Technical,09=Technical,10=Technical,11=Technical,12=power shot+,13=Technical,14=-';
    expect(r.stdout.split('\n').filter((l) => l.startsWith('STYLES'))).toEqual([expected, expected]);
  });

  it('stops with nothing changed on an unexpected name or several play styles', () => {
    for (const extra of [
      `INSERT INTO public.players (id, first_name, last_name, attributes) VALUES ('${P(20)}', 'Style', 'Unknown', '{"playStyles": [{"name": "Mystery Move"}]}');`,
      `INSERT INTO public.players (id, first_name, last_name, attributes) VALUES ('${P(21)}', 'Style', 'Two', '{"playStyles": [{"name": "Block"}, {"name": "Rapid"}]}');`,
    ]) {
      const r = psql(`${setup(extra)}
${body}
ROLLBACK;`);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/Play-style conversion stopped: .* Nothing was changed\./);
    }
  });

  it('uses exactly the catalog of public.play_style_names()', () => {
    const listed = [...script.matchAll(/unnest\(ARRAY\[([\s\S]*?)\]\)/g)][0][1].match(/'([^']+)'/g)!.map((s) => s.slice(1, -1));
    const db = spawnSync('psql', [LOCAL_DB, '-X', '-A', '-t', '-c', 'SELECT unnest(public.play_style_names())'], { encoding: 'utf8' }).stdout.trim().split('\n');
    expect(listed).toEqual(db);
  });

  it('touches only player play styles and runs in one transaction', () => {
    const code = script.replace(/--.*$/gm, '');
    expect(code.trim().startsWith('BEGIN;')).toBe(true);
    expect(code.trim().endsWith('COMMIT;')).toBe(true);
    expect(code.match(/\bUPDATE\s+public\.\w+/g)).toEqual(['UPDATE public.players']);
    expect(code).toMatch(/jsonb_set\(p\.attributes, '\{playStyles\}'/);
    const writes = code.replace(/ON COMMIT DROP/g, '');
    for (const w of ['DELETE', 'TRUNCATE', 'DROP', 'ALTER', 'INSERT', 'GRANT']) expect(writes, w).not.toMatch(new RegExp(`\\b${w}\\b`));
  });
});
