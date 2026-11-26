import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { COLLEGE_EMAIL_MESSAGE, isCollegeEmail } from '../lib/authRules';
import { friendly, roleHome } from '../lib/authApi';
import { appRoles } from '../context/AuthContext';
import { TurnstileWidget, turnstileSiteKey } from '../components/TurnstileWidget';
import { Field, Notice } from '../components/ui';

// The Super League mark, drawn in the ink colour through a mask of the logo file.
const MARK_MASK = {
  maskImage: 'url(/slklogo3.png)', WebkitMaskImage: 'url(/slklogo3.png)', maskSize: 'contain', WebkitMaskSize: 'contain',
  maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat', maskPosition: 'center', WebkitMaskPosition: 'center',
};
const PILL = 'inline-flex min-h-11 w-full items-center justify-center rounded-pill bg-ink px-6 text-sm font-black uppercase tracking-[0.2em] text-bg transition hover:opacity-85 disabled:pointer-events-none disabled:opacity-40';
const GLASS_PILL = 'glass inline-flex min-h-11 w-full items-center justify-center rounded-pill px-6 text-sm font-black uppercase tracking-[0.2em] text-ink transition hover:text-mut';

// The centred glass card every sign-in screen shares: the mark, a big heading, then the form.
function AuthShell({ heading, children }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-12 text-ink">
      <section className="glass flex w-full max-w-md flex-col gap-8 rounded-card p-6 sm:p-10">
        <span role="img" aria-label="Super League, IIIT Kottayam" className="block size-12 bg-ink" style={MARK_MASK} />
        <h1 className="font-display text-4xl text-ink sm:text-5xl">{heading}</h1>
        {children}
      </section>
    </main>
  );
}



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
    <AuthShell heading="Staff sign in">
      <div className="space-y-3">
        <p className="eyebrow">Super League staff</p>
        <p className="text-mut">For captains, scorers, editors and dictators. Use your college account.</p>
      </div>

      {error && <Notice tone="error" role="alert">{error}</Notice>}

      <form onSubmit={handleLogin} className="flex flex-col gap-5" noValidate>
        <Field label="Admin email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Field label="Passcode" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <TurnstileWidget onToken={setCaptchaToken} resetKey={captchaReset} />
        <button type="submit" disabled={loading} className={PILL}>
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>

      <Link to="/login" className="eyebrow inline-flex min-h-11 items-center hover:text-ink">Sign in as a student</Link>
    </AuthShell>
  );
}
