import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { GlassPanel } from '../components/GlassPanel';
import { ArrowLeft, LogIn, Mail } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';

export function Login() {
  const { signInWithGoogle, signInWithPassword, signUpWithPassword, requestPasswordReset, role, loading, user } = useAuth();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup' | 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();

  // The page the user was sent from, if any. Without one we keep the role-based default below.
  const from = location.state?.from?.pathname;

  // Save the destination before authentication.
  useEffect(() => {
    if (from && from !== "/") {
      sessionStorage.setItem('authRedirect', from);
    }
  }, [from]);

  // 3. When the user comes back and is authenticated, send them to the saved route
  useEffect(() => {
    if (user && role) {
      const roleDestination = {
        captain: '/team-builder',
        editor: '/editor',
        dictator: '/dictator',
        default: '/',
      }[role] || '/';
      sessionStorage.removeItem('authRedirect'); 
      navigate(roleDestination, { replace: true });
    }
  }, [user, role, navigate]);

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
    setBusy(true);
    setError(null);
    setNotice(null);
    if (mode === 'signin') {
      const { error: err } = await signInWithPassword(email, password);
      if (err) setError(err);
    } else if (mode === 'signup') {
      const { error: err, needsConfirmation } = await signUpWithPassword(email, password);
      if (err) setError(err);
      else if (needsConfirmation) setNotice('Check your college inbox for a confirmation link, then sign in. Already use Google with this email? No email will arrive: sign in with Google and add a password from your profile, or use Forgot password.');
    } else {
      const { error: err, message } = await requestPasswordReset(email);
      if (err) setError(err);
      else setNotice(message);
    }
    setBusy(false);
  };

  const inputClass = 'w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-sm text-white placeholder-zinc-600 focus:border-white/40 focus:outline-none';

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background aesthetics */}
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-white/5 rounded-full blur-[120px] -z-10 mix-blend-screen" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-zinc-500/10 rounded-full blur-[100px] -z-10 mix-blend-screen" />

      <GlassPanel className="max-w-md w-full p-8 sm:p-12 text-center relative z-10 border border-white/10 bg-black/60 backdrop-blur-2xl">
        <Link to="/" className="inline-flex items-center gap-2 text-xs text-zinc-500 hover:text-white uppercase tracking-widest mb-8"><ArrowLeft size={14} /> Back</Link>
        <h1 className="text-4xl sm:text-5xl font-black uppercase tracking-tighter mb-4 text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-500">
          Super League
        </h1>
        <p className="text-zinc-400 font-medium mb-8 tracking-wide uppercase text-sm">
          Sign in with your college account
        </p>
        <button type="button" onClick={handleGoogle} disabled={loading || busy} className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/15 bg-white/5 py-4 text-sm font-black uppercase tracking-widest text-white transition-colors hover:bg-white/10 disabled:opacity-50">
          <LogIn size={17} /> Continue with Google
        </button>

        <div className="my-6 flex items-center gap-3 text-[10px] uppercase tracking-widest text-zinc-600">
          <span className="h-px flex-1 bg-white/10" /> or use email and password <span className="h-px flex-1 bg-white/10" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 text-left" noValidate>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500" htmlFor="login-email">College email</label>
          <input id="login-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@iiitkottayam.ac.in" className={inputClass} required />
          {mode !== 'reset' && (
            <>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500" htmlFor="login-password">Password</label>
              <input id="login-password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} required />
            </>
          )}
          {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs font-bold text-red-400">{error}</p>}
          {notice && <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs font-bold text-emerald-300">{notice}</p>}
          <button type="submit" disabled={busy || loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-white py-3 text-sm font-black uppercase tracking-widest text-black transition-colors hover:bg-zinc-200 disabled:opacity-50">
            <Mail size={16} /> {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
          </button>
        </form>

        <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-2 text-[11px] uppercase tracking-widest text-zinc-500">
          {mode !== 'signin' && <button type="button" onClick={() => switchMode('signin')} className="hover:text-white">Sign in</button>}
          {mode !== 'signup' && <button type="button" onClick={() => switchMode('signup')} className="hover:text-white">Create account</button>}
          {mode !== 'reset' && <button type="button" onClick={() => switchMode('reset')} className="hover:text-white">Forgot password</button>}
        </div>

        <p className="mt-8 text-xs text-zinc-600 uppercase tracking-widest font-black">
          Only @iiitkottayam.ac.in accounts can sign in
        </p>
      </GlassPanel>
    </div>
  );
}
