// Group: auth-identity. Assigning a team captain must never silently replace another role ("no role implies another").
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The route reads its keys when it is imported, so the environment must exist before the import.
vi.hoisted(() => {
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable';
  process.env.SUPABASE_SECRET_KEY = 'test-secret';
});

const DICTATOR = 'u-dictator';
const state = {
  roles: {} as Record<string, string>,
  writes: [] as string[],
  registrationError: null as null | { code: string; message: string },
};

function fakeAdmin() {
  const table = (name: string) => {
    let filterId: string | null = null;
    const api: any = {
      select: () => api,
      eq: (_col: string, id: string) => {
        filterId = id;
        return api;
      },
      maybeSingle: async () => (name === 'teams'
        ? { data: filterId ? { name: `Team record ${filterId}` } : null, error: null }
        : { data: filterId && state.roles[filterId] ? { role: state.roles[filterId] } : null, error: null }),
      single: async () => (name === 'team_registrations' && state.registrationError
        ? { data: null, error: state.registrationError }
        : { data: { id: `${name}-1` }, error: null }),
      insert: () => {
        state.writes.push(`insert:${name}`);
        return api;
      },
      update: (row: any) => {
        state.writes.push(`update:${name}`);
        if (name === 'team_registrations') state.writes.push(`captain=${row.captain_id}`, `name=${row.team_name}`);
        return api;
      },
      upsert: (row: any) => {
        state.writes.push(`upsert:${name}`);
        if (name === 'user_roles') {
          state.roles[row.user_id] = row.role;
          state.writes.push(`role:${row.user_id}=${row.role}`);
        }
        return Object.assign(api, { then: (res: any) => res({ error: null }) });
      },
    };
    return api;
  };
  return { from: table };
}

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [] }) }));
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: DICTATOR } } }) } }) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeAdmin() }));
// The division/season lookup is covered against the real database in tests/divisions; here it is fixed.
vi.mock('@/lib/scope', () => ({
  ScopeError: class ScopeError extends Error {},
  resolveScope: async () => ({
    division: { id: 'd-freshers', slug: 'freshers', name: 'Freshers' },
    season: { id: 's-2026', slug: '2026', name: '2026', is_current: true, format: 'knockout' },
  }),
}));

import { POST } from '../../app/api/admin/team-registrations/route';

const assign = (captainId: string, extra: Record<string, unknown> = {}) =>
  POST(
    new Request('http://localhost/api/admin/team-registrations', {
      method: 'POST',
      body: JSON.stringify({ team_name: 'Test FC', division: 'freshers', captain_id: captainId, members: [], ...extra }),
    }),
  );

beforeEach(() => {
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable';
  process.env.SUPABASE_SECRET_KEY = 'test-secret';
  state.roles = { [DICTATOR]: 'dictator' };
  state.writes = [];
  state.registrationError = null;
});

describe('POST /api/admin/team-registrations: captain role assignment', () => {
  it('gives a user with the default role the captain role', async () => {
    state.roles.p1 = 'default';
    const res = await assign('p1');
    expect(res.status).toBe(200);
    expect(state.roles.p1).toBe('captain');
  });

  it('gives a user with no role row the captain role', async () => {
    const res = await assign('p2');
    expect(res.status).toBe(200);
    expect(state.roles.p2).toBe('captain');
  });

  it('leaves an existing captain alone', async () => {
    state.roles.p3 = 'captain';
    const res = await assign('p3');
    expect(res.status).toBe(200);
    expect(state.writes.some((w) => w.startsWith('role:p3'))).toBe(false);
  });

  it('keeps a dictator as a dictator (a dictator already manages every team)', async () => {
    state.roles.p4 = 'dictator';
    const res = await assign('p4');
    expect(res.status).toBe(200);
    expect(state.roles.p4).toBe('dictator');
  });

  it('refuses a caller who holds only the legacy admin role, before writing anything', async () => {
    state.roles[DICTATOR] = 'admin';
    state.roles.p6 = 'default';
    const res = await assign('p6');
    expect(res.status).toBe(401);
    expect(state.roles.p6).toBe('default');
    expect(state.writes).toEqual([]);
  });

  it('refuses an editor or a legacy admin, before writing anything', async () => {
    for (const role of ['editor', 'admin']) {
      state.roles.p5 = role;
      state.writes = [];
      const res = await assign('p5');
      expect(res.status, role).toBe(409);
      expect((await res.json()).message).toMatch(/not changed automatically/);
      expect(state.roles.p5).toBe(role);
      expect(state.writes).toEqual([]);
    }
  });
});

describe('POST /api/admin/team-registrations: changing a captain', () => {
  it('updates the existing registration in place instead of inserting a second one', async () => {
    state.roles.p7 = 'default';
    const res = await assign('p7', { id: 'reg-1', team_id: 'team-1' });
    expect(res.status).toBe(200);
    expect(state.writes).toContain('update:team_registrations');
    expect(state.writes).toContain('captain=p7');
    expect(state.writes).toContain('name=Team record team-1'); // the team's own name, not the client's 'Test FC'
    expect(state.writes.filter((w) => /^(insert|upsert):team_registrations/.test(w))).toEqual([]);
  });

  it('a new registration is inserted', async () => {
    state.roles.p8 = 'default';
    const res = await assign('p8', { team_id: 'team-2' });
    expect(res.status).toBe(200);
    expect(state.writes).toContain('insert:team_registrations');
    expect(state.writes).not.toContain('update:team_registrations');
  });

  it('explains when the account already captains another team', async () => {
    state.roles.p9 = 'captain';
    state.registrationError = { code: '23505', message: 'duplicate key value violates unique constraint "team_registrations_captain_id_key"' };
    const res = await assign('p9', { id: 'reg-1', team_id: 'team-1' });
    expect(res.status).toBe(409);
    expect((await res.json()).message).toMatch(/already captains another team/);
  });
});
