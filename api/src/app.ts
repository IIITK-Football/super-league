// The Super League API as one Hono application (D-05: one modular Worker on the Pages origin, no gateway).
// It mounts the runtime-neutral handlers from backend/app/api and applies what the Next middleware applied:
// - reads: a per-device rate limit;
// - writes (POST, PUT, PATCH, DELETE): a valid Supabase session token, checked before any handler runs, then a
//   per-account rate limit. PATCH is now included (the Next middleware missed it).
// Same origin only: the browser reaches this through the Pages /api function, so no CORS policy is served.
import { Hono } from 'hono';
import { routes, type RouteModule } from './routes';
import { checkRateLimit } from '../../backend/lib/rate-limit';
import { boundBucket, isMediaPurpose } from '../../backend/lib/storage';
import { bearerToken, publicClient, serverTiming, withTiming } from '../../backend/lib/supabase/clients';

const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const fail = (status: number, message: string) => Response.json({ success: false, message }, { status });

async function sessionUserId(authorization: string | undefined): Promise<string | null> {
  const token = bearerToken(authorization);
  if (!token) return null;
  // An expired or otherwise unverifiable token can throw rather than return an error; either way it is no session.
  try {
    const { data, error } = await publicClient().auth.getClaims(token);
    if (error || !data?.claims?.sub) return null;
    return data.claims.sub;
  } catch {
    return null;
  }
}

// Fail closed on configuration: a non-production Worker (staging, local) never talks to the production database.
// Staging must carry the production project's reference (wrangler.jsonc) so this check cannot be skipped by omission.
export function configProblem(env: Record<string, string | undefined> = process.env): string | null {
  const environment = env.SL_ENVIRONMENT;
  const url = env.SUPABASE_URL ?? '';
  const productionRef = env.SL_PRODUCTION_SUPABASE_REF ?? '';
  if (!url) return 'SUPABASE_URL is not set.';
  if (environment === 'production') return null;
  if (environment === 'staging' && !productionRef) return 'SL_PRODUCTION_SUPABASE_REF is not set for staging.';
  if (productionRef && url.includes(productionRef)) return 'This non-production Worker is configured with the production database.';
  return null;
}

// The deployed release, for /api/health: the Worker version (from the version metadata binding) and the commit the
// deploy command passed as SL_COMMIT. Both are null locally.
let release: { id?: string; tag?: string } | undefined;
export function setRelease(metadata: { id?: string; tag?: string } | undefined) {
  release = metadata;
}

export function createApp() {
  const app = new Hono().basePath('/api');

  app.use('*', async (_c, next) => {
    const problem = configProblem();
    if (problem) {
      console.error(`[CONFIG] refusing all requests: ${problem}`);
      return fail(503, 'The API is not configured correctly.');
    }
    return next();
  });

  // Server-Timing on every response (D-04): total time, Data API time and its sequential rounds. Counts and durations
  // only, never a query, key or token.
  app.use('*', async (c, next) => {
    const started = performance.now();
    const { result, timing } = withTiming(() => next());
    await result;
    const header = serverTiming(timing, performance.now() - started);
    try {
      c.res.headers.set('Server-Timing', header);
    } catch {
      c.res = new Response(c.res.body, c.res);
      c.res.headers.set('Server-Timing', header);
    }
  });

  app.get('/health', (c) => c.json({
    ok: true,
    service: 'super-league-api',
    environment: process.env.SL_ENVIRONMENT ?? 'unknown',
    commit: process.env.SL_COMMIT ?? null,
    version: release?.id ?? null,
  }));

  app.use('*', async (c, next) => {
    const method = c.req.method;
    if (!MUTATIONS.has(method)) {
      const device = `public_${c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? '127.0.0.1'}_${c.req.header('user-agent') ?? 'unknown-device'}`;
      if (!checkRateLimit(device, 60, 60_000).success) return fail(429, 'Too Many Requests');
      return next();
    }
    const userId = await sessionUserId(c.req.header('authorization'));
    if (!userId) return fail(401, 'Unauthorized: Middleware blocked request. Token missing or invalid.');
    if (!checkRateLimit(`admin_${userId}`, 100, 60_000).success) return fail(429, 'Too Many Requests (Admin Limit Reached)');
    return next();
  });

  // Local development only: emulated buckets have no public URL, so wrangler dev serves them here. Disabled
  // everywhere else (staging and production browsers load media straight from the bucket's public URL).
  app.get('/local-media/:purpose/*', async (c) => {
    if (process.env.SL_ENVIRONMENT !== 'local') return fail(404, 'Not Found');
    const purpose = c.req.param('purpose');
    if (!isMediaPurpose(purpose)) return fail(404, 'Not Found');
    const key = new URL(c.req.url).pathname.slice(`/api/local-media/${purpose}/`.length).split('/').map(decodeURIComponent).join('/');
    const object = key ? await boundBucket(purpose)?.get?.(key) : null;
    if (!object) return fail(404, 'Not Found');
    return new Response(object.body, { headers: { 'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream' } });
  });

  for (const [path, load] of routes) {
    let module: Promise<RouteModule> | null = null;
    app.on([...METHODS], path, async (c) => {
      module ??= load();
      const handler = (await module)[c.req.method as (typeof METHODS)[number]];
      if (!handler) return fail(405, 'Method Not Allowed');
      const params: Record<string, unknown> = { ...c.req.param() };
      if (path.endsWith('/*')) {
        const prefix = `/api${path.slice(0, -1)}`;
        params.path = new URL(c.req.url).pathname.slice(prefix.length).split('/').filter(Boolean).map(decodeURIComponent);
      }
      return handler(c.req.raw, { params: Promise.resolve(params) });
    });
  }

  app.notFound(() => fail(404, 'Not Found'));
  app.onError((error) => {
    console.error('[SERVER ERROR] - unhandled:', error);
    return fail(500, 'An unexpected internal server error occurred.');
  });
  return app;
}
