/* eslint-disable react/prop-types -- this codebase does not use prop-types */
import { useEffect, useState } from 'react';
import { Mail, Lock } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { roleHome } from '../lib/authApi';
import { TurnstileWidget, turnstileSiteKey } from '../components/TurnstileWidget';
import { Button, Field, Notice, TextInput } from '../components/ui';

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



// The one sign-in for people. The page they were headed to is kept (router state, or sessionStorage after Google
// sends them back here), then their role's home, then the home page.
export function Login() {
  const { signInWithGoogle, signInWithPassword, signUpWithPassword, requestPasswordReset, roles, rolesError, retryAuth, accessError, loading, user } = useAuth();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup' | 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [captchaToken, setCaptchaToken] = useState(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();

  // Where the person was headed: the route that sent them here, or this page when it is rendered inline.
  const from = location.state?.from?.pathname || (location.pathname !== '/login' ? location.pathname : null);
  useEffect(() => {
    if (from && from !== '/') sessionStorage.setItem('authRedirect', from);
  }, [from]);

  useEffect(() => {
    if (!user || loading || !roles) return;
    const saved = sessionStorage.getItem('authRedirect');
    sessionStorage.removeItem('authRedirect');
    navigate(saved && saved !== '/login' ? saved : roleHome(roles), { replace: true });
  }, [user, roles, loading, navigate]);

  const switchMode = (next) => {
    setMode(next);
    setError(null);
    setNotice(null);
  };

  const handleGoogle = async () => {
    setError(null);
    const { error: err } = await signInWithGoogle();
    if (err) setError(err);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    // Turnstile is checked by Supabase Auth; here we only make sure the user completed it.
    if (turnstileSiteKey() && !captchaToken) {
      setError('Please complete the verification first.');
      return;
    }
    setBusy(true);
    if (mode === 'signin') {
      const { error: err } = await signInWithPassword(email, password, captchaToken);
      if (err) setError(err);
    } else if (mode === 'signup') {
      const { error: err, needsConfirmation } = await signUpWithPassword(email, password, captchaToken);
      if (err) setError(err);
      else if (needsConfirmation) setNotice('Check your college inbox for a confirmation link, then sign in. Already use Google with this email? No email will arrive: sign in with Google and add a password from your profile, or use Forgot password.');
    } else {
      const { error: err, message } = await requestPasswordReset(email, captchaToken);
      if (err) setError(err);
      else setNotice(message);
    }
    // Tokens are single-use: ask for a fresh one after every attempt.
    setCaptchaToken(null);
    setCaptchaReset((n) => n + 1);
    setBusy(false);
  };

  const heading = { signin: 'Sign in', signup: 'Create an account', reset: 'Reset your password' }[mode];
  const submitLabel = { signin: 'Sign in', signup: 'Create account', reset: 'Send reset link' }[mode];
  const shownError = error || accessError;

  return (
    <AuthShell heading={heading}>
      <div className="space-y-3">
        <p className="text-mut">Use your college account. Only @iiitkottayam.ac.in addresses can sign in.</p>
      </div>

      {rolesError && (
        <div className="flex flex-col items-start gap-2">
          <Notice tone="error" role="alert">We could not load your access. Check your connection and try again.</Notice>
          <Button variant="secondary" size="sm" onClick={retryAuth}>Try again</Button>
        </div>
      )}
      {shownError && <Notice tone="error" role="alert">{shownError}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}

      {mode !== 'reset' && (
        <>
          <button type="button" onClick={handleGoogle} disabled={loading || busy} className={GLASS_PILL}>
            Continue with Google
          </button>
          <p className="eyebrow text-center">or use your email and password</p>
        </>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <Field label="College email">
          {(p) => <TextInput {...p} icon={Mail} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@iiitkottayam.ac.in" required />}
        </Field>
        {mode !== 'reset' && (
          <Field label="Password" hint={mode === 'signup' ? 'At least 8 characters, and not your email address.' : undefined}>
            {(p) => <TextInput {...p} icon={Lock} type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required />}
          </Field>
        )}
        <TurnstileWidget onToken={setCaptchaToken} resetKey={captchaReset} />
        <button type="submit" disabled={busy || loading} className={PILL}>
          {submitLabel}
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {mode !== 'signin' && <Button variant="quiet" size="sm" onClick={() => switchMode('signin')}>Sign in</Button>}
          {mode !== 'signup' && <Button variant="quiet" size="sm" onClick={() => switchMode('signup')}>Create account</Button>}
          {mode !== 'reset' && <Button variant="quiet" size="sm" onClick={() => switchMode('reset')}>Forgot password</Button>}
        </div>
        <Link to="/" className="eyebrow inline-flex min-h-11 items-center hover:text-ink">Back to home</Link>
      </div>
    </AuthShell>
  );
}
