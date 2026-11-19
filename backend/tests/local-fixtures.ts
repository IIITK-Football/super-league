// Local fixtures written the way the seed and migrations write them: a direct database session with no request JWT, so
// legacy rows the API now refuses (a player without an account, that player's roster place, a match key) can still be
// set up. THIS repository's LOCAL database only (127.0.0.1:54322); nothing remote is ever touched.
import { spawnSync } from 'node:child_process';

const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const NAME = /^[a-z_][a-z0-9_]*$/;
const QUOTE = '$fx$';

export function insertLocal<T = Record<string, any>>(table: 'players' | 'roster_memberships' | 'player_link_keys', rows: Record<string, unknown>[]): T[] {
  if (!rows.length) return [];
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  if (!cols.every((c) => NAME.test(c))) throw new Error(`bad column in ${cols.join(',')}`);
  const json = JSON.stringify(rows);
  if (json.includes(QUOTE)) throw new Error('fixture text may not contain the quote marker');
  const sql = [
    `WITH r AS (INSERT INTO public.${table} (${cols.join(', ')})`,
    `SELECT ${cols.map((c) => `(x).${c}`).join(', ')}`,
    `FROM (SELECT jsonb_populate_record(NULL::public.${table}, e) AS x FROM jsonb_array_elements(${QUOTE}${json}${QUOTE}::jsonb) e) s`,
    `RETURNING *) SELECT coalesce(json_agg(r), '[]') FROM r`,
  ].join('\n');
  const res = spawnSync('psql', [LOCAL_DB, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`local fixture insert into ${table} failed: ${res.stderr}`);
  return JSON.parse(res.stdout.trim()) as T[];
}
