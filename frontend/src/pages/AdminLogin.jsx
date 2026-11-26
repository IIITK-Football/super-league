import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { COLLEGE_EMAIL_MESSAGE, isCollegeEmail } from '../lib/authRules';
import { friendly, roleHome } from '../lib/authApi';
import { appRoles } from '../context/AuthContext';
import { TurnstileWidget, turnstileSiteKey } from '../components/TurnstileWidget';
import { Button, Card, Field, Notice, buttonClasses } from '../components/ui';

// Staff sign-in at /hq-login. Same account and rules as /login; it differs only in where it is linked from. After
// sign-in each person goes to the workspace their roles open (or home when they hold none).
export function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [captchaToken, setCaptchaToken] = useState(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  const fail = (message) => {
    setError(message);
    setLoading(false);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!isCollegeEmail(email)) return fail(COLLEGE_EMAIL_MESSAGE);

    // Turnstile is verified by Supabase Auth; here we only make sure it was completed.
    if (turnstileSiteKey() && !captchaToken) return fail('Please complete the verification first.');

    const credentials = { email: email.trim(), password };
    if (captchaToken) credentials.options = { captchaToken };
    const { error: signInError } = await supabase.auth.signInWithPassword(credentials);

    // Tokens are single-use: ask for a fresh one after every attempt.
    setCaptchaToken(null);
    setCaptchaReset((n) => n + 1);
    if (signInError) return fail(friendly(signInError));

    const { data: held, error: rolesError } = await supabase.rpc('my_roles');
    if (rolesError) return fail('Signed in, but we could not load your access. Try again.');
    window.location.assign(roleHome(appRoles(held)));
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 bg-bg px-4 py-10 text-ink">
      <Link to="/login" className={buttonClasses('quiet', 'sm', 'self-start')}>Sign in as a student</Link>
      <Card className="flex flex-col gap-6 p-6 sm:p-8">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-mut">Super League staff</p>
          <h1 className="font-display text-3xl font-bold">Staff sign in</h1>
          <p className="text-mut">For captains, scorers, editors and dictators. Use your college account.</p>
        </div>

        {error && <Notice tone="error" role="alert">{error}</Notice>}

        <form onSubmit={handleLogin} className="flex flex-col gap-5" noValidate>
          <Field label="Admin email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Field label="Passcode" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <TurnstileWidget onToken={setCaptchaToken} resetKey={captchaReset} />
          <Button type="submit" variant="primary" size="lg" disabled={loading} className="w-full">
            {loading ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </main>
  );
}
