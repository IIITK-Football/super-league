// Group: tooling. scripts/check-google-oauth.mjs asks a Supabase project's PUBLIC /auth/v1/authorize endpoint where
// Google sign-in would send the browser, and reports only the SHAPE of the client id (never its value).
import { describe, expect, it, vi } from 'vitest';
// @ts-ignore plain ESM script
import { analyze, checkGoogle } from '../../../scripts/check-google-oauth.mjs';

const PROJECT = 'https://abcdefghijklmnopqrst.supabase.co';
const REAL_ID = '1234567890-abcdefghijklmnop.apps.googleusercontent.com';

function googleRedirect(clientId: string, redirectUri = `${PROJECT}/auth/v1/callback`) {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', state: 'x' });
  return `https://accounts.google.com/o/oauth2/auth?${q}`;
}

describe('analyze', () => {
  it('reports ready for a real-shaped client id and a callback on the same project', () => {
    const r = analyze(PROJECT, 302, googleRedirect(REAL_ID), '');
    expect(r).toMatchObject({ verdict: 'ready', clientId: 'real-shaped', callbackMatchesProject: true });
  });

  it('flags the local placeholder client id (Google would answer invalid_client)', () => {
    const r = analyze(PROJECT, 302, googleRedirect('google-not-configured'), '');
    expect(r).toMatchObject({ verdict: 'placeholder-client', clientId: 'placeholder' });
  });

  it('flags a callback that belongs to a different host than the project', () => {
    const r = analyze(PROJECT, 302, googleRedirect(REAL_ID, 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co/auth/v1/callback'), '');
    expect(r).toMatchObject({ verdict: 'callback-mismatch', callbackMatchesProject: false });
  });

  it('reports disabled when the project says the provider is not enabled', () => {
    const r = analyze(PROJECT, 400, null, JSON.stringify({ msg: 'Unsupported provider: provider is not enabled' }));
    expect(r.verdict).toBe('disabled');
  });

  it('is inconclusive for anything else (unreachable, unexpected status)', () => {
    expect(analyze(PROJECT, 0, null, '').verdict).toBe('inconclusive');
    expect(analyze(PROJECT, 500, null, 'oops').verdict).toBe('inconclusive');
  });

  it('never includes the client id value in what it returns', () => {
    const r = analyze(PROJECT, 302, googleRedirect(REAL_ID), '');
    expect(JSON.stringify(r)).not.toContain('1234567890');
  });
});

describe('checkGoogle', () => {
  it('asks /authorize without following the redirect and without any key', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 302, headers: { get: () => googleRedirect(REAL_ID) }, text: async () => '' }));
    const r = await checkGoogle(PROJECT, fetchImpl as unknown as typeof fetch);
    expect(r.verdict).toBe('ready');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/auth/v1/authorize?provider=google');
    expect(init.redirect).toBe('manual');
    expect(JSON.stringify(init.headers ?? {})).not.toMatch(/apikey|authorization/i);
  });

  it('is inconclusive when the request throws', async () => {
    const r = await checkGoogle(PROJECT, vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch);
    expect(r.verdict).toBe('inconclusive');
  });
});
