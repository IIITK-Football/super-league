import { publishableKey } from '@/lib/supabase/keys';
import { createServerClient } from '@supabase/ssr';
import { COLLEGE_EMAIL_MESSAGE, isCollegeEmail } from '@/lib/auth/collegeEmail';
import { noCookies } from '@/lib/http';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body;
    // Turnstile token from the browser. Supabase Auth verifies it (the secret lives in Auth
    // settings), so this route only forwards it.
    const captchaToken =
      typeof body.captchaToken === 'string' && body.captchaToken.length > 0 ? body.captchaToken : undefined;

    // Trusted-side domain rule: reject before contacting Supabase Auth.
    if (!isCollegeEmail(email) || typeof password !== 'string' || password.length === 0) {
      return Response.json(
        { success: false, message: isCollegeEmail(email) ? 'Invalid login credentials' : COLLEGE_EMAIL_MESSAGE },
        { status: 400 }
      );
    }

    const cookieStore = noCookies;

    const supabase = createServerClient(
      process.env.SUPABASE_URL!,
      publishableKey(),
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          },
        },
      }
    );

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
      ...(captchaToken ? { options: { captchaToken } } : {}),
    });

    if (error) throw error;

    return Response.json({
      success: true,
      message: "Admin logged in successfully",
      data: {
        user: data.user,
        session: data.session 
      }
    });

  } catch (error: any) {
    console.error("Auth error:", error.message);
    return Response.json(
      { success: false, message: "Invalid login credentials" },
      { status: 401 }
    );
  }
}