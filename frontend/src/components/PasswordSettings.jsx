import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Button, Field, Notice } from './ui';

// Lets a signed-in user (including one who signed in with Google) add or change a website
// password on the same account. The Supabase user ID does not change. When Supabase asks for
// reauthentication (older session), a one-time code is emailed and must be entered first.
export function PasswordSettings() {
  const { setPassword: savePassword, requestPasswordChangeCode } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const sendCode = async () => {
    const { error: err, message } = await requestPasswordChangeCode();
    if (err) setError(err);
    else setNotice(message);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    const { error: err, needsReauth } = needsCode ? await savePassword(password, code) : await savePassword(password);
    if (!err) {
      setNotice('Password saved. You can now sign in with your college email and this password.');
      setPassword('');
      setConfirm('');
      setCode('');
      setNeedsCode(false);
    } else if (needsReauth && !needsCode) {
      setNeedsCode(true); // first time: email the code and ask for it
      await sendCode();
    } else {
      setError(err);
    }
    setBusy(false);
  };

  const handleSendNewCode = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    await sendCode();
    setBusy(false);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-2xl text-ink">Website password</h2>
        <p className="text-sm text-mut">Add a password to sign in with your college email as well as Google. It stays on this same account.</p>
      </div>
      <Field label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 8 characters, and not your email address." required />
      <Field label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      {needsCode && (
        <div className="flex flex-col gap-2">
          <Field label="Code from your email" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
          <Button variant="quiet" size="sm" onClick={handleSendNewCode} disabled={busy} className="self-start">Send a new code</Button>
        </div>
      )}
      {error && <Notice tone="error" role="alert">{error}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}
      <button type="submit" disabled={busy || !password} className="inline-flex min-h-11 items-center rounded-pill border border-line px-6 text-sm font-black uppercase tracking-[0.2em] text-ink transition hover:border-mut disabled:pointer-events-none disabled:opacity-40 self-start">
        {busy ? 'Saving...' : 'Save password'}
      </button>
    </form>
  );
}
