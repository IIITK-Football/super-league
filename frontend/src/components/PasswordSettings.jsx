import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

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

  const inputClass = 'w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-sm text-white focus:border-white/40 focus:outline-none';

  return (
    <form onSubmit={handleSubmit} className="space-y-3 text-left" noValidate>
      <h2 className="text-sm font-black uppercase tracking-widest text-white">Website password</h2>
      <p className="text-xs text-zinc-500">Add a password to sign in with your college email as well as Google. It stays on this same account.</p>
      <input type="password" aria-label="New password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password" className={inputClass} required />
      <input type="password" aria-label="Confirm new password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm new password" className={inputClass} required />
      {needsCode && (
        <div className="space-y-2">
          <input type="text" inputMode="numeric" aria-label="Email code" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code from your email" className={inputClass} required />
          <button type="button" onClick={handleSendNewCode} disabled={busy} className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 hover:text-white disabled:opacity-50">
            Send a new code
          </button>
        </div>
      )}
      {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs font-bold text-red-400">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs font-bold text-emerald-300">{notice}</p>}
      <button type="submit" disabled={busy || !password} className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-white/10 disabled:opacity-50">
        <KeyRound size={14} /> {busy ? 'Saving...' : 'Save password'}
      </button>
    </form>
  );
}
