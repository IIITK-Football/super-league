/* eslint-disable react/prop-types -- this codebase does not use prop-types */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { roleHome } from '../lib/authApi';
import { Field, Notice, Skeleton, TextInput, toast } from '../components/ui';

// The Super League mark, drawn in the ink colour through a mask of the logo file.
const MARK_MASK = {
  maskImage: 'url(/slklogo3.png)', WebkitMaskImage: 'url(/slklogo3.png)', maskSize: 'contain', WebkitMaskSize: 'contain',
  maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat', maskPosition: 'center', WebkitMaskPosition: 'center',
};
const PILL = 'inline-flex min-h-11 w-full items-center justify-center rounded-pill bg-ink px-6 text-sm font-black uppercase tracking-[0.2em] text-bg transition hover:opacity-85 disabled:pointer-events-none disabled:opacity-40';

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



// Reached from the password-reset email. Supabase signs the user in with a recovery session;
// the new password is then set on that same account.
export function ResetPassword() {
  const { user, roles, loading, completePasswordReset } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    const { error: err } = await completePasswordReset(password);
    setBusy(false);
    if (err) setError(err);
    else {
      toast({ title: 'Password saved', tone: 'success' });
      navigate(roleHome(roles), { replace: true });
    }
  };

  const mismatch = confirm && password !== confirm ? 'The two passwords do not match.' : undefined;
  let body;
  if (loading) {
    body = <Skeleton className="h-40 w-full" />;
  } else if (!user) {
    body = (
      <Notice tone="error" role="alert">
        This reset link is invalid or has expired. Request a new one from the sign-in page.
      </Notice>
    );
  } else {
    body = (
      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <Field label="New password" hint="At least 8 characters, and not your email address.">
          {(p) => <TextInput {...p} icon={Lock} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
        </Field>
        <Field label="Confirm password" error={mismatch}>
          {(p) => <TextInput {...p} icon={Lock} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />}
        </Field>
        {error && <Notice tone="error" role="alert">{error}</Notice>}
        <button type="submit" disabled={busy} className={PILL}>
          {busy ? 'Saving...' : 'Save password'}
        </button>
      </form>
    );
  }

  return (
    <AuthShell heading="Choose a new password">
      {body}
      <Link to="/login" className="eyebrow inline-flex min-h-11 items-center hover:text-ink">Back to sign in</Link>
    </AuthShell>
  );
}
