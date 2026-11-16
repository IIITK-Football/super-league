import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { GlassPanel } from '../components/GlassPanel';
import { Loader } from '../components/Loader';

// Reached from the password-reset email. Supabase signs the user in with a recovery session;
// the new password is then set on that same account.
export function ResetPassword() {
  const { user, loading, completePasswordReset } = useAuth();
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
    else navigate('/', { replace: true });
  };

  const inputClass = 'w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-sm text-white focus:border-white/40 focus:outline-none';

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
      <GlassPanel className="max-w-md w-full p-8 sm:p-12 border border-white/10 bg-black/60 backdrop-blur-2xl">
        <Link to="/login" className="inline-flex items-center gap-2 text-xs text-zinc-500 hover:text-white uppercase tracking-widest mb-8"><ArrowLeft size={14} /> Back to sign in</Link>
        <h1 className="text-3xl font-black uppercase tracking-tighter mb-6">Choose a new password</h1>
        {loading ? (
          <div className="flex justify-center"><Loader /></div>
        ) : !user ? (
          <p role="alert" className="text-sm text-zinc-400">This reset link is invalid or has expired. Request a new one from the sign-in page.</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3" noValidate>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500" htmlFor="new-password">New password</label>
            <input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} required />
            <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500" htmlFor="confirm-password">Confirm password</label>
            <input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} required />
            {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs font-bold text-red-400">{error}</p>}
            <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-white py-3 text-sm font-black uppercase tracking-widest text-black hover:bg-zinc-200 disabled:opacity-50">
              <KeyRound size={16} /> {busy ? 'Saving...' : 'Save password'}
            </button>
          </form>
        )}
      </GlassPanel>
    </div>
  );
}
