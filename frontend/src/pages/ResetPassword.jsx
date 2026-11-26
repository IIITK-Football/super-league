import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { roleHome } from '../lib/authApi';
import { Button, Card, Field, Notice, Skeleton, buttonClasses } from '../components/ui';

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
    else navigate(roleHome(roles), { replace: true });
  };

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
        <Field label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 8 characters, and not your email address." required />
        <Field label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        {error && <Notice tone="error" role="alert">{error}</Notice>}
        <Button type="submit" variant="primary" size="lg" disabled={busy} className="w-full">
          {busy ? 'Saving...' : 'Save password'}
        </Button>
      </form>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 bg-bg px-4 py-10 text-ink">
      <Link to="/login" className={buttonClasses('quiet', 'sm', 'self-start')}>Back to sign in</Link>
      <Card className="flex flex-col gap-6 p-6 sm:p-8">
        <h1 className="font-display text-3xl font-bold">Choose a new password</h1>
        {body}
      </Card>
    </main>
  );
}
