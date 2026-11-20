// The Super League API as one Hono application (D-05: one modular Worker on the Pages origin, no gateway).
// It mounts the runtime-neutral handlers from backend/app/api and applies what the Next middleware applied:
// - reads: a per-device rate limit;
// - writes (POST, PUT, PATCH, DELETE): a valid Supabase session token, checked before any handler runs, then a
//   per-account rate limit. PATCH is now included (the Next middleware missed it).
// Same origin only: the browser reaches this through the Pages /api function, so no CORS policy is served.
import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { routes, type RouteModule } from './routes';
import { checkRateLimit } from '../../backend/lib/rate-limit';

const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const fail = (status: number, message: string) => Response.json({ success: false, message }, { status });

async function sessionUserId(authorization: string | undefined): Promise<string | null> {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) return null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Missing required environment variable: SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY');
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) return null;
  return data.claims.sub;
}

export function createApp() {
  const app = new Hono().basePath('/api');

  app.get('/health', (c) => c.json({ ok: true, service: 'super-league-api' }));

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
