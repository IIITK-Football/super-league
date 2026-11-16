import { COLLEGE_EMAIL_DOMAIN, COLLEGE_EMAIL_MESSAGE, isCollegeEmail, validateNewPassword } from './authRules';

const fail = (error) => ({ error });

function friendly(error) {
  const msg = error?.message || '';
  if (/invalid login credentials/i.test(msg)) return 'Incorrect email or password.';
  if (/email not confirmed/i.test(msg)) return 'Please confirm your email first. Check your inbox for the confirmation link.';
  if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Please wait a few minutes and try again.';
  if (/provider is not enabled|unsupported provider/i.test(msg)) {
    return 'Google sign-in is not set up in this environment. Use your college email and password instead.';
  }
  return msg || 'Something went wrong. Please try again.';
}

/**
 * Auth actions for the website. `supabase` is injected so the rules can be tested.
 * Every email action checks the college domain before contacting Supabase, and password
 * changes always go through the signed-in account (updateUser) so the user ID never changes.
 */
export function createAuthApi(supabase, { origin }) {
  const auth = supabase.auth;

  async function signInWithPassword(email, password) {
    if (!isCollegeEmail(email)) return fail(COLLEGE_EMAIL_MESSAGE);
    const { error } = await auth.signInWithPassword({ email: email.trim(), password });
    return error ? fail(friendly(error)) : { error: null };
  }

  async function signUpWithPassword(email, password) {
    if (!isCollegeEmail(email)) return fail(COLLEGE_EMAIL_MESSAGE);
    const bad = validateNewPassword(password, email);
    if (bad) return fail(bad);
    const { data, error } = await auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: `${origin}/login` },
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

  async function setPassword(password) {
    const { data } = await auth.getSession();
    if (!data?.session) return fail('Please sign in first.');
    const bad = validateNewPassword(password, data.session.user?.email);
    if (bad) return fail(bad);
    const { error } = await auth.updateUser({ password });
    return error ? fail(friendly(error)) : { error: null };
  }

  async function linkGoogle() {
    const { error } = await auth.linkIdentity({ provider: 'google', options: { redirectTo: `${origin}/profile` } });
    return error ? fail(friendly(error)) : { error: null };
  }

  async function requestPasswordReset(email) {
    if (!isCollegeEmail(email)) return fail(COLLEGE_EMAIL_MESSAGE);
    const { error } = await auth.resetPasswordForEmail(email.trim(), { redirectTo: `${origin}/reset-password` });
    if (error && /rate limit|too many/i.test(error.message || '')) return fail(friendly(error));
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

  return { signInWithPassword, signUpWithPassword, signInWithGoogle, setPassword, linkGoogle, requestPasswordReset, completePasswordReset };
}
