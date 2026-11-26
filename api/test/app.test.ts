// Group: api-worker. The Hono Worker app, run in Node against THIS repository's local Supabase stack
// (127.0.0.1:54321): the mounted routes answer with the same handlers as Next, writes need a valid session before any
// handler runs (PATCH included), unknown and retired routes are 404, and route params reach the handlers.
import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { configProblem, createApp } from '../src/app';
import { routes } from '../src/routes';
import { localKeys } from '../../backend/tests/auth/local-supabase';

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  const keys = localKeys();
  Object.assign(process.env, { SUPABASE_URL: keys.url, SUPABASE_PUBLISHABLE_KEY: keys.publishable, SUPABASE_SECRET_KEY: keys.secret });
  app = createApp();
});

const call = (path: string, init?: RequestInit) => app.request(`http://localhost/api${path}`, init);

describe('api worker', () => {
  it('reports health', async () => {
    const res = await call('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, service: 'super-league-api' });
  });

  it('fails closed when a non-production Worker is pointed at the production database', async () => {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, { SL_ENVIRONMENT: 'staging', SL_PRODUCTION_SUPABASE_REF: 'obkxfepdpdufxawhzaen', SUPABASE_URL: 'https://obkxfepdpdufxawhzaen.supabase.co' });
      const refused = await call('/health');
      expect(refused.status).toBe(503);
      expect(refused.headers.get('Cache-Control')).toBe('no-store');
      expect((await call('/standings')).status).toBe(503);
    } finally {
      process.env = saved;
    }
  });

  it('fails closed when staging lacks the production marker or the database URL', () => {
    expect(configProblem({ SL_ENVIRONMENT: 'staging', SUPABASE_URL: 'https://yecozsiccsfwphlmxozt.supabase.co' })).toMatch(/SL_PRODUCTION_SUPABASE_REF/);
    expect(configProblem({ SL_ENVIRONMENT: 'staging', SL_PRODUCTION_SUPABASE_REF: 'obkxfepdpdufxawhzaen' })).toMatch(/SUPABASE_URL/);
    expect(configProblem({ SL_ENVIRONMENT: 'staging', SL_PRODUCTION_SUPABASE_REF: 'obkxfepdpdufxawhzaen', SUPABASE_URL: 'https://yecozsiccsfwphlmxozt.supabase.co' })).toBeNull();
    expect(configProblem({ SL_ENVIRONMENT: 'local', SUPABASE_URL: 'http://127.0.0.1:54321' })).toBeNull();
  });

  it('serves a public read through the shared handler, scoped to a division', async () => {
    const res = await call('/standings?division=super-league');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('passes route params to the handler', async () => {
    const res = await call('/teams/00000000-0000-0000-0000-000000000000/matches');
    expect([200, 404]).toContain(res.status);
    expect((await res.json()).success).not.toBeUndefined();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('refuses %s without a session before any handler runs', async (method) => {
    const res = await call(method === 'PATCH' ? '/wc/flair' : '/admin/matches', { method, body: '{}' });
    expect(res.status).toBe(401);
  });

  it('refuses a write with a forged token', async () => {
    const res = await call('/admin/matches', { method: 'POST', headers: { Authorization: 'Bearer not-a-token' }, body: '{}' });
    expect(res.status).toBe(401);
  });

  it.each(['/auth/login', '/admin/stats', '/admin/teams', '/legends', '/wc/test', '/wc/sync/manual', '/wc/grade/groups', '/no-such-route'])(
    'does not serve %s',
    async (path) => {
      expect((await call(path)).status).toBe(404);
    },
  );

  // SL-031: stable error and cache behaviour on the same-origin /api contract.
  it('answers errors as JSON with success false, and never lets a response be cached by default', async () => {
    for (const [path, init, status] of [
      ['/no-such-route', undefined, 404],
      ['/admin/matches', { method: 'POST', body: '{}' }, 401],
      ['/standings?division=no-such-division', undefined, 404],
      ['/standings?division=Bad%20Slug', undefined, 400],
    ] as [string, RequestInit | undefined, number][]) {
      const res = await call(path, init);
      expect(res.status, path).toBe(status);
      expect(res.headers.get('Content-Type'), path).toMatch(/application\/json/);
      expect((await res.json()).success, path).toBe(false);
      expect(res.headers.get('Cache-Control'), path).toBe('no-store');
    }
    const ok = await call('/standings?division=super-league');
    expect(ok.headers.get('Cache-Control')).toBe('no-store');
    expect(ok.headers.get('Server-Timing')).toMatch(/^total;dur=/);
  });

  it('answers 405 for a method the handler does not export', async () => {
    expect((await call('/standings', { method: 'OPTIONS' })).status).toBe(405);
  });

  it('every mounted route points at an existing handler module', () => {
    for (const [path] of routes) {
      const dir = path.replace('/*', '/[...path]').replace(/:([a-z_]+)/g, '[$1]');
      expect(existsSync(join(__dirname, '../../backend/app/api', dir, 'route.ts')), path).toBe(true);
    }
  });
});
