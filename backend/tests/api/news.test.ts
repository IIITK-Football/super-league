// News paging never asks the database for an invalid range.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, reset } from './fake-supabase';

vi.hoisted(() => {
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable';
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
});
vi.mock('@supabase/ssr', async () => (await import('./fake-supabase')).ssrModule);

import { GET } from '../../app/api/news/route';

beforeEach(() => {
  reset();
  db.tables.newsletter = { data: [], error: null, count: 0 };
});

describe('GET /api/news', () => {
  it('clamps page and limit to at least one', async () => {
    const res = await GET(new Request('http://localhost/api/news?page=0&limit=0'));
    expect(res.status).toBe(200);
    expect(db.calls.find((c) => c.target === 'newsletter' && c.method === 'range')?.args).toEqual([0, 9]);
  });
});
