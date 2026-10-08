import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { checkRateLimit } from './lib/rate-limit'; 

export async function proxy(request: NextRequest) {
  const origin = request.headers.get('origin') || '';
  const allowedOrigin = /^https:\/\/([a-z0-9-]+\.)?super-league\.pages\.dev$/i.test(origin)
    || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
    || /^http:\/\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):\d+$/.test(origin);
  const withCors = (response: NextResponse) => {
    if (allowedOrigin) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Credentials', 'true');
      response.headers.set('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
      response.headers.set('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');
      response.headers.append('Vary', 'Origin');
    }
    return response;
  };

  if (request.method === 'OPTIONS') {
    return withCors(new NextResponse(null, { status: 204 }));
  }

  const isMutation = ['POST', 'PUT', 'DELETE'].includes(request.method);
  
  // 1. PUBLIC READ RATE LIMIT 
  if (!isMutation) {
    const ip = request.headers.get('x-forwarded-for') || '127.0.0.1';
    const userAgent = request.headers.get('user-agent') || 'unknown-device';
    const deviceFingerprint = `public_${ip}_${userAgent}`;
    
    const limitCheck = checkRateLimit(deviceFingerprint, 60, 60 * 1000);
    
    if (!limitCheck.success) {
      return withCors(NextResponse.json({ success: false, message: 'Too Many Requests' }, { status: 429 }));
    }
    return withCors(NextResponse.next());
  }

  // 2. EXCEPTIONS
  if (request.nextUrl.pathname === '/api/auth/login') {
    return withCors(NextResponse.next());
  }

  if (request.nextUrl.pathname === '/api/polls/vote') {
    const ip = request.headers.get('x-forwarded-for') || '127.0.0.1';
    const voteLimitCheck = checkRateLimit(`vote_${ip}`, 5, 60 * 1000);
    
    if (!voteLimitCheck.success) {
      return withCors(NextResponse.json({ success: false, message: 'Too Many Votes' }, { status: 429 }));
    }
    return withCors(NextResponse.next());
  }

  // 3. MUTATION SECURITY 
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  );

  // THE MAGIC FIX: Read the Bearer token from the header we sent from the frontend!
  const authHeader = request.headers.get('Authorization');
  let user = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    // Pass the token directly to Supabase so it doesn't need cookies!
    const { data } = await supabase.auth.getUser(token);
    user = data?.user;
  } else {
    // Fallback just in case
    const { data } = await supabase.auth.getUser();
    user = data?.user;
  }

  // Block unauthorized users immediately
  if (!user) {
    return withCors(NextResponse.json(
      { success: false, message: 'Unauthorized: Middleware blocked request. Token missing or invalid.' },
      { status: 401 }
    ));
  }

  // BUMPED TO 100: So you can actually build your roster without getting rate-limited!
  const adminLimitCheck = checkRateLimit(`admin_${user.id}`, 100, 60 * 1000);
  
  if (!adminLimitCheck.success) {
    return withCors(NextResponse.json({ success: false, message: 'Too Many Requests (Admin Limit Reached)' }, { status: 429 }));
  }

  return withCors(supabaseResponse);
}

export const config = {
  matcher: [
    '/api/:path*',
  ],
};
