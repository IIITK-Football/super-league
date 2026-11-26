// The only way server code builds a Supabase client (D-04). Three kinds, each built per request, with sessions and
// token refresh off:
// - publicClient(): publishable key, public reads under RLS;
// - userClient(token) / requestClient(request): publishable key plus the caller's token, so RLS and the audit actor
//   are the person;
// - jobClient(): secret key, bypasses RLS. Only the reviewed modules in supabase-key-usage.test.ts may import it, and a
//   write a person starts never uses it.
// Every Data API call goes through timedFetch: 8 s for requests, 20 s for jobs, one retry for an idempotent read that
// failed on the network, and per-request round counting for the Server-Timing header.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { publishableKey, secretKey, supabaseUrl } from './keys';
import { noCookies } from '../http';

export const REQUEST_TIMEOUT_MS = 8_000;
export const JOB_TIMEOUT_MS = 20_000;

// Rounds are sequential waves of Data API calls: a call that starts while another is in flight joins its round.
type Timing = { rounds: number; calls: number; inFlight: number; busySince: number; busyMs: number };
const timingStore = new AsyncLocalStorage<Timing>();
const now = () => performance.now();

export function withTiming<T>(fn: () => T): { result: T; timing: Timing } {
  const timing: Timing = { rounds: 0, calls: 0, inFlight: 0, busySince: 0, busyMs: 0 };
  return { result: timingStore.run(timing, fn), timing };
}

export const currentTiming = (): Timing | undefined => timingStore.getStore();

function begin(t: Timing | undefined) {
  if (!t) return;
  t.calls += 1;
  if (t.inFlight === 0) {
    t.rounds += 1;
    t.busySince = now();
  }
  t.inFlight += 1;
}

function end(t: Timing | undefined) {
  if (!t) return;
  t.inFlight -= 1;
  if (t.inFlight === 0) t.busyMs += now() - t.busySince;
}

// A Server-Timing value with durations and counts only: never a query, key, token or URL.
export function serverTiming(timing: Timing, totalMs: number): string {
  const ms = (n: number) => Math.max(0, n).toFixed(1);
  return `total;dur=${ms(totalMs)}, db;dur=${ms(timing.busyMs)};desc="rounds=${timing.rounds} calls=${timing.calls}"`;
}

const isNetworkError = (error: unknown) =>
  error instanceof TypeError || (error instanceof Error && !['AbortError', 'TimeoutError'].includes(error.name) && /network|fetch failed|ECONNRESET/i.test(error.message));

function methodOf(input: RequestInfo | URL, init?: RequestInit) {
  return (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

export function timedFetch(timeoutMs: number, base: typeof fetch = (...args) => fetch(...args)): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const attempt = () => {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
      return base(input, { ...init, signal });
    };
    const timing = currentTiming();
    begin(timing);
    try {
      try {
        return await attempt();
      } catch (error) {
        const method = methodOf(input, init);
        if ((method === 'GET' || method === 'HEAD') && isNetworkError(error)) return await attempt();
        throw error;
      }
    } finally {
      end(timing);
    }
  };
}

const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

export function publicClient(): SupabaseClient {
  return createClient(supabaseUrl(), publishableKey(), { auth, global: { fetch: timedFetch(REQUEST_TIMEOUT_MS) } });
}

// The caller's client. Built like the handlers always built it (@supabase/ssr with no cookies and the bearer header),
// so auth.getUser() keeps answering for the caller.
function callerClientFor(authorization: string | null): SupabaseClient {
  return createServerClient(supabaseUrl(), publishableKey(), {
    cookies: { getAll: () => noCookies.getAll(), setAll() {} },
    global: { fetch: timedFetch(REQUEST_TIMEOUT_MS), headers: authorization ? { Authorization: authorization } : {} },
  }) as unknown as SupabaseClient;
}

export const userClient = (token: string): SupabaseClient => callerClientFor(`Bearer ${token}`);

// The request's caller when it sent a bearer token, otherwise an anonymous client (RLS decides either way).
export const requestClient = (request: Request): SupabaseClient =>
  callerClientFor(request.headers.get('Authorization'));

export function jobClient(): SupabaseClient {
  return createClient(supabaseUrl(), secretKey(), { auth, global: { fetch: timedFetch(JOB_TIMEOUT_MS) } });
}

export const bearerToken = (authorization: string | null | undefined): string =>
  authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
