// Group: config. D-04 transport rules for the server's Supabase clients: timeouts, retrying only idempotent reads on a
// network error, round counting for Server-Timing, and a caller's token never shared between clients.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  JOB_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  bearerToken,
  currentTiming,
  serverTiming,
  timedFetch,
  userClient,
  withTiming,
} from '@/lib/supabase/clients';

const ok = () => new Response('[]', { status: 200 });

afterEach(() => vi.useRealTimers());

describe('timedFetch', () => {
  it('aborts a call that outlives its timeout', async () => {
    const base = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason));
    }));
    await expect(timedFetch(20, base as typeof fetch)('http://x/rest/v1/t')).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('retries an idempotent read once after a network error', async () => {
    const base = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(ok());
    const res = await timedFetch(1000, base)('http://x/rest/v1/t', { method: 'GET' });
    expect(res.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('never retries a write, a timeout, or a second network error', async () => {
    const post = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(timedFetch(1000, post)('http://x/rest/v1/rpc/f', { method: 'POST' })).rejects.toThrow('fetch failed');
    expect(post).toHaveBeenCalledTimes(1);

    const twice = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(timedFetch(1000, twice)('http://x/rest/v1/t')).rejects.toThrow('fetch failed');
    expect(twice).toHaveBeenCalledTimes(2);

    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const slow = vi.fn().mockRejectedValue(timeout);
    await expect(timedFetch(1000, slow)('http://x/rest/v1/t')).rejects.toBe(timeout);
    expect(slow).toHaveBeenCalledTimes(1);
  });

  it('keeps a caller-supplied abort signal working', async () => {
    const controller = new AbortController();
    const base = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason));
    }));
    const pending = timedFetch(10_000, base as typeof fetch)('http://x', { signal: controller.signal });
    controller.abort(new Error('caller cancelled'));
    await expect(pending).rejects.toThrow('caller cancelled');
  });

  it('uses the D-04 limits', () => {
    expect(REQUEST_TIMEOUT_MS).toBe(8_000);
    expect(JOB_TIMEOUT_MS).toBe(20_000);
  });
});

describe('round counting', () => {
  const delayed = (ms: number) => vi.fn(() => new Promise<Response>((resolve) => setTimeout(() => resolve(ok()), ms)));

  it('counts parallel calls as one round and sequential calls as separate rounds', async () => {
    const f = timedFetch(1000, delayed(5));
    const { result, timing } = withTiming(async () => {
      await Promise.all([f('http://x/a'), f('http://x/b'), f('http://x/c')]);
      await f('http://x/d');
      return currentTiming();
    });
    expect(await result).toBe(timing);
    expect(timing.calls).toBe(4);
    expect(timing.rounds).toBe(2);
    expect(timing.inFlight).toBe(0);
    expect(timing.busyMs).toBeGreaterThan(0);
  });

  it('is a no-op outside a request', async () => {
    expect(currentTiming()).toBeUndefined();
    await expect(timedFetch(1000, vi.fn().mockResolvedValue(ok()))('http://x')).resolves.toBeInstanceOf(Response);
  });

  it('formats Server-Timing with durations and counts only', () => {
    const header = serverTiming({ rounds: 2, calls: 5, inFlight: 0, busySince: 0, busyMs: 12.345 }, 40.04);
    expect(header).toBe('total;dur=40.0, db;dur=12.3;desc="rounds=2 calls=5"');
  });
});

describe('caller clients', () => {
  it('extracts only a Bearer token', () => {
    expect(bearerToken('Bearer abc ')).toBe('abc');
    expect(bearerToken('Basic abc')).toBe('');
    expect(bearerToken(undefined)).toBe('');
  });

  it('builds a new client for each caller, so a token never leaks to another request', async () => {
    Object.assign(process.env, { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' });
    const seen: (string | null)[] = [];
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      seen.push(new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get('Authorization'));
      return ok();
    });
    try {
      const a = userClient('token-a');
      const b = userClient('token-b');
      expect(a).not.toBe(b);
      await a.from('t').select('*');
      await b.from('t').select('*');
      expect(seen).toEqual(['Bearer token-a', 'Bearer token-b']);
    } finally {
      spy.mockRestore();
    }
  });
});
