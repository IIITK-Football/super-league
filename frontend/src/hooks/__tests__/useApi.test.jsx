// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: null } })) } },
}));
vi.mock('../../lib/api', () => ({ API_BASE_URL: '/api' }));
vi.mock('../../context/LeagueContext', () => ({
  useLeague: () => ({ seasonScope: { ready: true } }),
  scopeQuery: () => 'division=super-league',
}));

import { useApi } from '../useApi';

const respond = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('useApi', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('returns the data of a successful response and scopes the request', async () => {
    fetch.mockResolvedValueOnce(respond(200, { data: [1] }));
    const { result } = renderHook(() => useApi('/teams'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ data: [1] });
    expect(result.current.error).toBeNull();
    expect(fetch.mock.calls[0][0]).toBe('/api/teams?division=super-league');
  });

  it('treats a non-ok response as an error and keeps data null', async () => {
    fetch.mockResolvedValueOnce(respond(403, { error: 'Sign in as a dictator.' }));
    const { result } = renderHook(() => useApi('/admin/teams'));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toEqual({ status: 403, message: 'Sign in as a dictator.' });
    expect(result.current.data).toBeNull();
  });

  it('hides the raw body of a server error behind a generic message', async () => {
    fetch.mockResolvedValueOnce(respond(500, { error: 'relation "matches" does not exist' }));
    const { result } = renderHook(() => useApi('/matches'));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error.status).toBe(500);
    expect(result.current.error.message).not.toMatch(/relation/);
  });

  it('reports a network failure and retry loads again', async () => {
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fetch.mockResolvedValueOnce(respond(200, { data: ['ok'] }));
    const { result } = renderHook(() => useApi('/standings'));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error.status).toBe(0);
    await act(async () => { result.current.retry(); });
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.data).toEqual({ data: ['ok'] });
  });
});
