// The Pages /api function forwards every request, unchanged, to the API Worker binding and nowhere else.
import { describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../../functions/api/[[path]].js';

describe('pages /api function', () => {
  it('forwards the request unchanged to the API binding', async () => {
    const request = new Request('https://site.example/api/standings?division=super-league', { headers: { Authorization: 'Bearer t' } });
    const fetch = vi.fn(async () => new Response('ok', { status: 200 }));
    const res = await onRequest({ request, env: { API: { fetch } } });
    expect(fetch).toHaveBeenCalledWith(request);
    expect(res.status).toBe(200);
  });

  it('fails closed with 503 when the binding is missing', async () => {
    const res = await onRequest({ request: new Request('https://site.example/api/news'), env: {} });
    expect(res.status).toBe(503);
    expect((await res.json()).success).toBe(false);
  });
});
