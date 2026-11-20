// Shared fixture for the auth-roles tests: real accounts with chosen grants, a throw-away division with a current, a
// completed and an upcoming season, two teams, matches, and the clean-up. Everything runs against THIS repository's
// local Supabase stack (127.0.0.1:54321/54322) and removes what it creates.
import type { SupabaseClient } from '@supabase/supabase-js';
import { clients, localKeys, uniqueEmail } from '../auth/local-supabase';

export type Roles = {
  admin: SupabaseClient;
  anon: () => SupabaseClient;
  keys: ReturnType<typeof localKeys>;
  users: string[];
  made: { divisions: string[]; teams: string[]; matches: string[] };
};

export function startFixture(): Roles {
  const keys = localKeys();
  const c = clients(keys);
  return { admin: c.admin, anon: c.anon, keys, users: [], made: { divisions: [], teams: [], matches: [] } };
}

/** A confirmed account holding the given grants, and a signed-in token and client for it. */
export async function account(f: Roles, label: string, grants: string[] = []) {
  const email = uniqueEmail(`roles-${label}`);
  const { data, error } = await f.admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  f.users.push(data.user.id);
  for (const role of grants) {
    const r = await f.admin.from('user_roles').insert({ user_id: data.user.id, role });
    if (r.error) throw r.error;
  }
  const link = await f.admin.auth.admin.generateLink({ type: 'magiclink', email });
  const db = f.anon();
  const { data: v, error: vErr } = await db.auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: 'magiclink' });
  if (vErr) throw vErr;
  return { id: data.user.id, token: v.session!.access_token, db };
}

const must = <T>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

/** A division with a current, a completed and an upcoming season, two teams entered in each, and two matches in the current one. */
export async function world(f: Roles, tag: string) {
  const division = must(await f.admin.from('divisions').insert({ slug: `${tag}`, name: `Roles ${tag}` }).select('id').single()).id as string;
  f.made.divisions.push(division);
  const season = async (slug: string, status: string, current: boolean) =>
    must(await f.admin.from('seasons').insert({ division_id: division, slug, name: slug, status, is_current: current }).select('id').single()).id as string;
  const cur = await season('cur', 'active', true);
  const old = await season('old', 'completed', false);
  const next = await season('next', 'planned', false);
  const teams = must(await f.admin.from('teams').insert([{ name: `${tag} Reds` }, { name: `${tag} Blues` }]).select('id')) as { id: string }[];
  f.made.teams.push(...teams.map((t) => t.id));
  const entries: Record<string, string[]> = {};
  for (const [name, id] of [['cur', cur], ['old', old], ['next', next]] as const) {
    entries[name] = (must(await f.admin.from('team_entries').insert(teams.map((t) => ({ team_id: t.id, season_id: id }))).select('id')) as { id: string }[]).map((e) => e.id);
  }
  const matches = must(await f.admin.from('matches').insert([
    { home_team_id: teams[0].id, away_team_id: teams[1].id, season_id: cur, status: 'scheduled', date: new Date(Date.now() + 86400000).toISOString() },
    { home_team_id: teams[1].id, away_team_id: teams[0].id, season_id: cur, status: 'scheduled', date: new Date(Date.now() + 2 * 86400000).toISOString() },
  ]).select('id')) as { id: string }[];
  f.made.matches.push(...matches.map((m) => m.id));
  return { division, seasons: { cur, old, next }, teams: teams.map((t) => t.id), entries, matches: matches.map((m) => m.id) };
}

export async function cleanup(f: Roles) {
  if (!f.admin) return;
  for (const id of f.made.matches) await f.admin.from('matches').delete().eq('id', id);
  if (f.made.teams.length) await f.admin.from('team_entries').delete().in('team_id', f.made.teams);
  for (const id of f.made.teams) await f.admin.from('teams').delete().eq('id', id);
  for (const id of f.made.divisions) {
    await f.admin.from('seasons').delete().eq('division_id', id);
    await f.admin.from('divisions').delete().eq('id', id);
  }
  for (const id of f.users) await f.admin.auth.admin.deleteUser(id);
}
