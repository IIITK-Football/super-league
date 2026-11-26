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

  it('returns the Worker answer as it is, status, headers and body included', async () => {
    const answer = new Response('{"success":false}', { status: 401, headers: { 'Cache-Control': 'no-store', 'Server-Timing': 'total;dur=1' } });
    const res = await onRequest({ request: new Request('https://site.example/api/admin/matches', { method: 'POST' }), env: { API: { fetch: async () => answer } } });
    expect(res).toBe(answer);
  });

  it('fails closed with 503 when the binding is missing', async () => {
    const res = await onRequest({ request: new Request('https://site.example/api/news'), env: {} });
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect((await res.json()).success).toBe(false);
  });
});
