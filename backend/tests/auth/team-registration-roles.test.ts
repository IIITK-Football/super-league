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
      maybeSingle: async () => ({ data: filterId && state.roles[filterId] ? { role: state.roles[filterId] } : null, error: null }),
      single: async () => ({ data: { id: `${name}-1` }, error: null }),
      insert: () => {
        state.writes.push(`insert:${name}`);
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

const assign = (captainId: string) =>
  POST(
    new Request('http://localhost/api/admin/team-registrations', {
      method: 'POST',
      body: JSON.stringify({ team_name: 'Test FC', division: 'freshers', captain_id: captainId, members: [] }),
    }),
  );

beforeEach(() => {
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable';
  process.env.SUPABASE_SECRET_KEY = 'test-secret';
  state.roles = { [DICTATOR]: 'dictator' };
  state.writes = [];
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
