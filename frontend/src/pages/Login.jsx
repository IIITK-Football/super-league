import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { roleHome } from '../lib/authApi';
import { TurnstileWidget, turnstileSiteKey } from '../components/TurnstileWidget';
import { Button, Card, Field, Notice, buttonClasses } from '../components/ui';

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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 bg-bg px-4 py-10 text-ink">
      <Link to="/" className={buttonClasses('quiet', 'sm', 'self-start')}>Back to home</Link>
      <Card className="flex flex-col gap-6 p-6 sm:p-8">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-mut">Super League</p>
          <h1 className="font-display text-3xl font-bold">{heading}</h1>
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
            <Button variant="secondary" size="lg" onClick={handleGoogle} disabled={loading || busy} className="w-full">
              Continue with Google
            </Button>
            <p className="text-center text-sm text-mut">or use your email and password</p>
          </>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
          <Field
            label="College email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@iiitkottayam.ac.in"
            required
          />
          {mode !== 'reset' && (
            <Field
              label="Password"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              hint={mode === 'signup' ? 'At least 8 characters, and not your email address.' : undefined}
              required
            />
          )}
          <TurnstileWidget onToken={setCaptchaToken} resetKey={captchaReset} />
          <Button type="submit" variant="primary" size="lg" disabled={busy || loading} className="w-full">
            {submitLabel}
          </Button>
        </form>

        <div className="flex flex-wrap justify-center gap-2">
          {mode !== 'signin' && <Button variant="quiet" size="sm" onClick={() => switchMode('signin')}>Sign in</Button>}
          {mode !== 'signup' && <Button variant="quiet" size="sm" onClick={() => switchMode('signup')}>Create account</Button>}
          {mode !== 'reset' && <Button variant="quiet" size="sm" onClick={() => switchMode('reset')}>Forgot password</Button>}
        </div>
      </Card>
    </main>
  );
}
