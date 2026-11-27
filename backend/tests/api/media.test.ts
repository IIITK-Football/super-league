import { beforeEach, describe, expect, it, vi } from 'vitest';

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('../../lib/supabase/clients', () => ({ publicClient: () => ({ from: () => {
  const query = { select: () => query, eq: () => query, is: () => query, limit: lookup };
  return query;
} }) }));
vi.mock('../../lib/storage', () => ({ StorageError: class StorageError extends Error {}, videoBase: () => 'https://videos.example' }));
import { GET } from '../../app/api/media/[...path]/route';
const request = (path: string[]) => GET(new Request('http://localhost/api/media/test'), { params: Promise.resolve({ path }) });

beforeEach(() => { lookup.mockReset(); vi.restoreAllMocks(); });
describe('division videos', () => {
  it('allows a configured public division video', async () => {
    lookup.mockResolvedValue({ data: [{ id: 'division' }], error: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('video')));
    expect((await request(['new-video', 'chunk.ts'])).status).toBe(200);
    vi.unstubAllGlobals();
  });
  it('rejects unconfigured keys and traversal', async () => {
    lookup.mockResolvedValue({ data: [], error: null });
    expect((await request(['private', 'chunk.ts'])).status).toBe(404);
    expect((await request(['..', 'chunk.ts'])).status).toBe(404);
  });
});
