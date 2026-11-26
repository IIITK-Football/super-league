import { COLLEGE_EMAIL_DOMAIN, COLLEGE_EMAIL_MESSAGE, isCollegeEmail, validateNewPassword } from './authRules';

const fail = (error) => ({ error });

// The one place a sign-in or account error becomes copy a person reads. Raw provider messages are never shown.
export function friendly(error) {
  const msg = error?.message || '';
  if (/invalid login credentials/i.test(msg)) return 'Incorrect email or password.';
  if (/email not confirmed/i.test(msg)) return 'Please confirm your email first. Check your inbox for the confirmation link.';
  if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Please wait a few minutes and try again.';
  if (/captcha/i.test(msg)) return 'The verification did not complete. Please try the verification again.';
  if (/provider is not enabled|unsupported provider/i.test(msg)) {
    return 'Google sign-in is unavailable right now. Use your college email and password instead.';
  }
  return 'Something went wrong. Please try again.';
}

// Where each role's workspace lives. A person with no staff role goes to the home page.
export function roleHome(roles) {
  if (!Array.isArray(roles)) return '/';
  if (roles.includes('dictator')) return '/dictator';
  if (roles.includes('captain')) return '/team-builder';
  if (roles.includes('editor')) return '/editor';
  if (roles.includes('scorer')) return '/dictator';
  return '/';
}

// The World Cup teams, one list for onboarding and the profile.
export async function fetchWorldCupTeams(apiBase) {
  const res = await fetch(`${apiBase}/wc/teams`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success || !Array.isArray(json.data)) throw new Error('The nation list could not be loaded.');
  return [...json.data].sort((a, b) => a.name.localeCompare(b.name));
}

// The World Cup pick goes through the one endpoint that writes it (the caller's own row only).
export async function saveWorldCupFlair(supabase, apiBase, userId, flair) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${apiBase}/wc/flair`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify({ user_id: userId, wc_team_flair: flair }),
  });
  if (!res.ok) throw new Error('Your World Cup pick was not saved.');
}

/**
 * Auth actions for the website. `supabase` is injected so the rules can be tested.
 * Every email action checks the college domain before contacting Supabase, and password
 * changes always go through the signed-in account (updateUser) so the user ID never changes.
 */
export function createAuthApi(supabase, { origin }) {
  const auth = supabase.auth;

  // Turnstile tokens are verified by Supabase Auth (the secret lives in Auth settings, never here).
  // When verification is not enabled there is no token and nothing extra is sent.
  const withCaptcha = (options, captchaToken) => (captchaToken ? { ...options, captchaToken } : options);

  async function signInWithPassword(email, password, captchaToken) {
    if (!isCollegeEmail(email)) return fail(COLLEGE_EMAIL_MESSAGE);
    const credentials = { email: email.trim(), password };
    if (captchaToken) credentials.options = { captchaToken };
    const { error } = await auth.signInWithPassword(credentials);
    return error ? fail(friendly(error)) : { error: null };
  }

  async function signUpWithPassword(email, password, captchaToken) {
    if (!isCollegeEmail(email)) return fail(COLLEGE_EMAIL_MESSAGE);
    const bad = validateNewPassword(password, email);
    if (bad) return fail(bad);
    const { data, error } = await auth.signUp({
      email: email.trim(),
      password,
      options: withCaptcha({ emailRedirectTo: `${origin}/login` }, captchaToken),
    });
    if (error) return fail(friendly(error));
    return { error: null, needsConfirmation: !data?.session };
  }

  async function signInWithGoogle() {
    const { error } = await auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${origin}/login`,
        // Hints Google's chooser toward college accounts; enforcement happens server-side.
        queryParams: { prompt: 'select_account', hd: COLLEGE_EMAIL_DOMAIN },
      },
    });
    return error ? fail(friendly(error)) : { error: null };
  }

  // Changing a password on an older session needs an emailed one-time code (Supabase "Secure
  // password change"). `needsReauth` tells the caller to ask for the code and retry with it.
  async function setPassword(password, code) {
    const { data } = await auth.getSession();
    if (!data?.session) return fail('Please sign in first.');
    const bad = validateNewPassword(password, data.session.user?.email);
    if (bad) return fail(bad);
    const payload = { password };
    if (code && String(code).trim()) payload.nonce = String(code).trim();
    const { error } = await auth.updateUser(payload);
    if (!error) return { error: null };
    const msg = error.message || '';
    if (/nonce/i.test(msg)) {
      return { error: 'That code is incorrect or has expired. Send a new code and try again.', needsReauth: true };
    }
    if (/reauthentication/i.test(msg)) {
      return { error: 'For your security, enter the code we email you to change your password.', needsReauth: true };
    }
    return fail(friendly(error));
  }

  async function requestPasswordChangeCode() {
    const { data } = await auth.getSession();
    if (!data?.session) return fail('Please sign in first.');
    const { error } = await auth.reauthenticate();
    if (error) return fail(friendly(error));
    return { error: null, message: 'We emailed a code to your college address. Enter it below to finish.' };
  }

  async function linkGoogle() {
    const { error } = await auth.linkIdentity({ provider: 'google', options: { redirectTo: `${origin}/profile` } });
    return error ? fail(friendly(error)) : { error: null };
  }

  async function requestPasswordReset(email, captchaToken) {
    if (!isCollegeEmail(email)) return fail(COLLEGE_EMAIL_MESSAGE);
    const { error } = await auth.resetPasswordForEmail(
      email.trim(),
      withCaptcha({ redirectTo: `${origin}/reset-password` }, captchaToken),
    );
    if (error && /rate limit|too many|captcha/i.test(error.message || '')) return fail(friendly(error));
    // Same answer whether or not an account exists (no account enumeration).
    return { error: null, message: 'If an account exists for that email, a reset link is on its way.' };
  }

  async function completePasswordReset(password) {
    return setPasswordForRecovery(password);
  }

  async function setPasswordForRecovery(password) {
    const bad = validateNewPassword(password);
    if (bad) return fail(bad);
    const { error } = await auth.updateUser({ password });
    return error ? fail(friendly(error)) : { error: null };
  }

  return {
    signInWithPassword,
    signUpWithPassword,
    signInWithGoogle,
    setPassword,
    requestPasswordChangeCode,
    linkGoogle,
    requestPasswordReset,
    completePasswordReset,
  };
}
