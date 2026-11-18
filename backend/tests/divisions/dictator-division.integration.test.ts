// Group: divisions. Runs against THIS repository's local Supabase stack (Auth + Data API on 127.0.0.1:54321).
// A dictator creates a brand-new division (Inter) with two coexisting seasons and its sections through the
// ordinary Data API, with no code or schema change. Every other role and anonymous callers are refused, and
// hidden or archived records stay private. Roles follow docs/decisions/SL-003-role-capability-matrix.md.
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clients, localKeys, uniqueEmail } from '../auth/local-supabase';

const PASSWORD = 'division-test-password-1';
const ROLES = ['dictator', 'captain', 'editor', 'default'] as const;
type Role = (typeof ROLES)[number];

let admin: SupabaseClient;
let anon: () => SupabaseClient;
const users = new Map<Role, { id: string; client: SupabaseClient }>();
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const slug = `inter-${suffix}`;
let divisionId: string | undefined;

async function signedIn(role: Role) {
  const email = uniqueEmail(`division-${role}`);
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  const { error: roleError } = await admin.from('user_roles').update({ role }).eq('user_id', data.user.id);
  if (roleError) throw roleError;
  const client = anon();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;
  users.set(role, { id: data.user.id, client });
}

const as = (role: Role) => users.get(role)!.client;

beforeAll(async () => {
  const c = clients(localKeys());
  admin = c.admin;
  anon = c.anon;
  for (const role of ROLES) await signedIn(role);
});

afterAll(async () => {
  if (divisionId) {
    const { data: seasons } = await admin.from('seasons').select('id').eq('division_id', divisionId);
    const ids = (seasons ?? []).map((s) => s.id);
    if (ids.length) {
      await admin.from('season_sections').delete().in('season_id', ids);
      await admin.from('seasons').delete().in('id', ids);
    }
    await admin.from('divisions').delete().eq('id', divisionId);
  }
  for (const { id } of users.values()) await admin.auth.admin.deleteUser(id);
});

describe('a dictator configures a new division as data', () => {
  it('creates the division, two coexisting seasons and their sections', async () => {
    const division = await as('dictator')
      .from('divisions')
      .insert({ slug, name: 'Inter', short_name: 'Inter', primary_color: '#112233', sort_order: 4 })
      .select('id, slug, name, visibility, archived_at')
      .single();
    expect(division.error).toBeNull();
    expect(division.data).toMatchObject({ slug, name: 'Inter', visibility: 'public', archived_at: null });
    divisionId = division.data!.id;

    const seasons = await as('dictator')
      .from('seasons')
      .insert([
        { division_id: divisionId, slug: '2026', name: '2026', status: 'active', is_current: true, format: 'league_knockout' },
        { division_id: divisionId, slug: '2027', name: '2027', status: 'planned' },
        // A multi-row insert sends missing keys as NULL unless told to use the column defaults.
      ], { defaultToNull: false })
      .select('id, slug, is_current');
    expect(seasons.error).toBeNull();
    expect(seasons.data).toHaveLength(2);

    const current = seasons.data!.find((s) => s.slug === '2026')!;
    const types = await as('dictator').from('section_types').select('key');
    expect(types.error).toBeNull();
    const sections = await as('dictator')
      .from('season_sections')
      .insert(
        types.data!.map((t, i) => ({
          season_id: current.id,
          section_key: t.key,
          enabled: t.key !== 'fantasy',
          sort_order: i,
          settings: t.key === 'news' ? { placement: 'top' } : {},
        })),
      )
      .select('section_key, enabled');
    expect(sections.error).toBeNull();
    expect(sections.data!.find((s) => s.section_key === 'fantasy')?.enabled).toBe(false);

    // Public readers see the new division and both seasons.
    const publicSeasons = await anon().from('seasons').select('slug').eq('division_id', divisionId);
    expect(publicSeasons.data?.map((s) => s.slug).sort()).toEqual(['2026', '2027']);
  });

  it('keeps a second current season out (one current season per division)', async () => {
    const r = await as('dictator')
      .from('seasons')
      .insert({ division_id: divisionId, slug: 'dup', name: 'Dup', is_current: true });
    expect(r.error?.code).toBe('23505');
  });

  it('archives a season instead of deleting it, and hides it from everyone but dictators', async () => {
    const archived = await as('dictator')
      .from('seasons')
      .update({ archived_at: new Date().toISOString() })
      .eq('division_id', divisionId)
      .eq('slug', '2027')
      .select('id');
    expect(archived.error).toBeNull();
    expect(archived.data).toHaveLength(1);

    for (const client of [anon(), as('default'), as('captain')]) {
      const r = await client.from('seasons').select('slug').eq('division_id', divisionId);
      expect(r.data?.map((s) => s.slug)).toEqual(['2026']);
    }
    const r = await as('dictator').from('seasons').select('slug').eq('division_id', divisionId);
    expect(r.data?.map((s) => s.slug).sort()).toEqual(['2026', '2027']);
  });

  it('hides a hidden division from the public', async () => {
    const hidden = await as('dictator').from('divisions').update({ visibility: 'hidden' }).eq('id', divisionId).select('id');
    expect(hidden.data).toHaveLength(1);
    expect((await anon().from('divisions').select('id').eq('id', divisionId)).data).toEqual([]);
    expect((await as('default').from('divisions').select('id').eq('id', divisionId)).data).toEqual([]);
    expect((await anon().from('seasons').select('id').eq('division_id', divisionId)).data).toEqual([]);
    expect((await as('dictator').from('divisions').select('id').eq('id', divisionId)).data).toHaveLength(1);
    await as('dictator').from('divisions').update({ visibility: 'public' }).eq('id', divisionId);
  });
});

describe('no other role can configure divisions', () => {
  for (const role of ['captain', 'editor', 'default'] as const) {
    it(`${role === 'default' ? 'a normal user' : `a ${role}`} is refused`, async () => {
      const create = await as(role).from('divisions').insert({ slug: `${role}-${suffix}`, name: 'Nope' });
      expect(create.error?.code).toBe('42501');

      const season = await as(role).from('seasons').insert({ division_id: divisionId, slug: `x-${role}`, name: 'Nope' });
      expect(season.error?.code).toBe('42501');

      const rename = await as(role).from('divisions').update({ name: 'Renamed' }).eq('id', divisionId).select('id');
      expect(rename.data ?? []).toEqual([]);

      const sections = await as(role).from('season_sections').update({ enabled: true }).eq('section_key', 'fantasy').select('season_id');
      expect(sections.data ?? []).toEqual([]);

      const remove = await as(role).from('divisions').delete().eq('id', divisionId).select('id');
      expect(remove.data ?? []).toEqual([]);
    });
  }

  it('anonymous callers are refused', async () => {
    const r = await anon().from('divisions').insert({ slug: `anon-${suffix}`, name: 'Nope' });
    expect(r.error).toBeTruthy();
  });

  it('the division is unchanged after every refused attempt', async () => {
    const r = await admin.from('divisions').select('name').eq('id', divisionId).single();
    expect(r.data?.name).toBe('Inter');
  });
});
