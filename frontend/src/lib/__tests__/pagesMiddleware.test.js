// Group: config. The Cloudflare Pages Function reads one newsletter row for share previews. It must use only
// the publishable key, send it as `apikey` (new keys are not JWTs, so never as a Bearer token), and skip the
// request when it is not configured.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../../functions/_middleware.js';

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ title: 'Match report', summary: 'A summary', image_url: null }] });
  vi.stubGlobal('fetch', fetchMock);
  // Cloudflare's HTMLRewriter is not available in Node: a pass-through stand-in is enough here.
  vi.stubGlobal('HTMLRewriter', class { on() { return this; } transform(r) { return r; } });
});
afterEach(() => vi.unstubAllGlobals());

const call = (env) =>
  onRequest({
    request: new Request('https://example.test/article/abc123'),
    next: async () => new Response('<html><head></head></html>', { headers: { 'content-type': 'text/html' } }),
    env,
  });

describe('Pages Function newsletter lookup', () => {
  it('queries the project with only the publishable key as apikey', async () => {
    await call({ SUPABASE_URL: 'https://project.example.test', SUPABASE_PUBLISHABLE_KEY: 'publishable-placeholder' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('https://project.example.test/rest/v1/newsletter?id=eq.abc123');
    expect(init.headers).toEqual({ apikey: 'publishable-placeholder' });
  });

  it('never sends a key as an Authorization Bearer token', async () => {
    await call({ SUPABASE_URL: 'https://project.example.test', SUPABASE_PUBLISHABLE_KEY: 'publishable-placeholder' });
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('authorization');
  });

  it('does not read the old anon key variable and skips the lookup instead of sending a bad request', async () => {
    const res = await call({ SUPABASE_URL: 'https://project.example.test', SUPABASE_ANON_KEY: 'old-anon' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toBe(200); // default share tags are still served
  });

  it('skips the lookup when the project URL is missing', async () => {
    await call({ SUPABASE_PUBLISHABLE_KEY: 'publishable-placeholder' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
