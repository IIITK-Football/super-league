// Newsletter articles: editors and dictators create and edit; only a dictator deletes.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, reset } from './fake-supabase';

vi.hoisted(() => {
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable';
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
});
vi.mock('@supabase/ssr', async () => (await import('./fake-supabase')).ssrModule);

import { DELETE, POST, PUT } from '../../app/api/admin/newsletter/route';

const ID = '3f2c1a4e-8b7d-4c6e-9a1f-0d2e3c4b5a69';
const VALID = { title: 'Matchday one', summary: 'The opener', content: [{ type: 'paragraph', value: 'Hello' }] };
const req = (method: string, url: string, body?: unknown) => new Request(`http://localhost${url}`, {
  method,
  headers: { Authorization: 'Bearer t' },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const put = (body: unknown, id = ID) => PUT(req('PUT', `/api/admin/newsletter?id=${id}`, body));
const asRoles = (roles: string[]) => {
  db.user = { id: 'someone' };
  db.rpc.my_roles = { data: roles, error: null };
};

beforeEach(() => {
  reset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  db.tables.newsletter = { data: { id: ID, title: 'Matchday one' }, error: null };
});

describe('PUT /api/admin/newsletter', () => {
  it('lets an editor edit an article', async () => {
    asRoles(['editor']);
    const res = await put({ ...VALID, title: 'Matchday one (fixed)' });
    expect(res.status).toBe(200);
    const update = db.calls.find((c) => c.method === 'update');
    expect(update?.args[0]).toMatchObject({ title: 'Matchday one (fixed)', summary: 'The opener' });
    expect(db.calls.some((c) => c.method === 'eq' && c.args[0] === 'id' && c.args[1] === ID)).toBe(true);
  });

  it('lets a dictator edit an article', async () => {
    asRoles(['dictator']);
    expect((await put(VALID)).status).toBe(200);
  });

  it('refuses a signed-out caller', async () => {
    expect((await put(VALID)).status).toBe(401);
    expect(db.calls.some((c) => c.method === 'update')).toBe(false);
  });

  it.each([
    ['a normal user', []],
    ['a captain', ['captain']],
    ['a scorer', ['scorer']],
  ])('refuses %s', async (_label, roles) => {
    asRoles(roles);
    const res = await put(VALID);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ success: false });
    expect(db.calls.some((c) => c.method === 'update')).toBe(false);
  });

  it('rejects a blank title or summary before writing', async () => {
    asRoles(['editor']);
    const res = await put({ ...VALID, title: '   ' });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/title/i);
    expect((await put({ ...VALID, summary: '' })).status).toBe(400);
    expect(db.calls.some((c) => c.method === 'update')).toBe(false);
  });

  it('rejects a request without an article id', async () => {
    asRoles(['editor']);
    const res = await put(VALID, '');
    expect(res.status).toBe(400);
  });

  it('reports a missing article as not found', async () => {
    asRoles(['editor']);
    db.tables['newsletter.update'] = { data: null, error: null };
    expect((await put(VALID)).status).toBe(404);
  });
});

describe('DELETE /api/admin/newsletter', () => {
  it('refuses an editor', async () => {
    asRoles(['editor']);
    const res = await DELETE(req('DELETE', `/api/admin/newsletter?id=${ID}`));
    expect(res.status).toBe(403);
    expect(db.deletes).toEqual([]);
  });

  it('lets a dictator delete', async () => {
    asRoles(['dictator']);
    const res = await DELETE(req('DELETE', `/api/admin/newsletter?id=${ID}`));
    expect(res.status).toBe(200);
    expect(db.deletes).toEqual(['newsletter']);
  });
});

describe('POST /api/admin/newsletter', () => {
  it('lets an editor publish and rejects a blank title', async () => {
    asRoles(['editor']);
    expect((await POST(req('POST', '/api/admin/newsletter', VALID))).status).toBe(200);
    expect((await POST(req('POST', '/api/admin/newsletter', { ...VALID, title: '' }))).status).toBe(400);
  });
});
