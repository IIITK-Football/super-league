import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { checkRateLimit } from './lib/rate-limit'; // Adjust path if using '@/lib/rate-limit'

export async function middleware(request: NextRequest) {
  const origin = request.headers.get('origin') || '';

  // Matches all Cloudflare Pages domains (*.super-league.pages.dev) and local dev environments
  const isAllowedOrigin =
    /^https:\/\/([a-z0-9-]+\.)?super-league\.pages\.dev$/i.test(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1|172\.16\.\d+\.\d+|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/i.test(origin);

  // Helper to dynamically inject CORS headers into any response
  const applyCors = (response: NextResponse) => {
    if (isAllowedOrigin && origin) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Credentials', 'true');
      response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS, PATCH, DELETE, POST, PUT');
      response.headers.set(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
      );
      response.headers.append('Vary', 'Origin');
    }
    return response;
  };

  // 1. Preflight OPTIONS requests (crucial for cross-origin frontend calls)
  if (request.method === 'OPTIONS') {
    return applyCors(new NextResponse(null, { status: 204 }));
  }

  const isMutation = ['POST', 'PUT', 'DELETE'].includes(request.method);

  // 2. Public Read Rate Limiting
  if (!isMutation) {
    const ip = request.headers.get('x-forwarded-for') || '127.0.0.1';
    const userAgent = request.headers.get('user-agent') || 'unknown-device';
    const deviceFingerprint = `public_${ip}_${userAgent}`;

    const limitCheck = checkRateLimit(deviceFingerprint, 60, 60 * 1000);

    if (!limitCheck.success) {
      return applyCors(
        NextResponse.json({ success: false, message: 'Too Many Requests' }, { status: 429 })
      );
    }
    return applyCors(
      NextResponse.next({
        request: { headers: request.headers },
      })
    );
  }

  // 3. Exception Routes
  if (request.nextUrl.pathname === '/api/auth/login') {
    return applyCors(
      NextResponse.next({
        request: { headers: request.headers },
      })
    );
  }

  if (request.nextUrl.pathname === '/api/polls/vote') {
    const ip = request.headers.get('x-forwarded-for') || '127.0.0.1';
    const voteLimitCheck = checkRateLimit(`vote_${ip}`, 5, 60 * 1000);

    if (!voteLimitCheck.success) {
      return applyCors(
        NextResponse.json({ success: false, message: 'Too Many Votes' }, { status: 429 })
      );
    }
    return applyCors(
      NextResponse.next({
        request: { headers: request.headers },
      })
    );
  }

  // 4. Mutation Authorization & Supabase Context
  let supabaseResponse = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const authHeader = request.headers.get('Authorization');
  let user = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const { data } = await supabase.auth.getUser(token);
    user = data?.user;
  } else {
    const { data } = await supabase.auth.getUser();
    user = data?.user;
  }

  if (!user) {
    return applyCors(
      NextResponse.json(
        { success: false, message: 'Unauthorized: Middleware blocked request. Token missing or invalid.' },
        { status: 401 }
      )
    );
  }

  // 5. Admin Mutation Rate Limiting
  const adminLimitCheck = checkRateLimit(`admin_${user.id}`, 100, 60 * 1000);

  if (!adminLimitCheck.success) {
    return applyCors(
      NextResponse.json(
        { success: false, message: 'Too Many Requests (Admin Limit Reached)' },
        { status: 429 }
      )
    );
  }

  return applyCors(supabaseResponse);
}

export const config = {
  matcher: ['/api/:path*'],
};
