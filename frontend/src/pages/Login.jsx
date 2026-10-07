import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { GlassPanel } from '../components/GlassPanel';
import { ArrowLeft, KeyRound, LogIn, Mail, UserPlus } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';

export function Login() {
  const { signInWithGoogle, signInWithPassword, signUpWithPassword, role, loading, user } = useAuth();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const location = useLocation();
  const navigate = useNavigate();

  // 1. Grab the intended destination (defaults to "/")
  const from = location.state?.from?.pathname || "/team-builder";

  const demoEmail = import.meta.env.VITE_DEMO_EMAIL || 'demo@iiitkottayam.ac.in';
  const demoPassword = import.meta.env.VITE_DEMO_PASSWORD || 'SuperLeagueDemo26!';

  // Save the destination before authentication.
  useEffect(() => {
    if (from !== "/") {
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

  const handlePasswordAuth = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (password.length < 6) {
      setError('Use a password with at least 6 characters.');
      return;
    }

    const result = mode === 'login'
      ? await signInWithPassword(email, password)
      : await signUpWithPassword(email, password);

    if (result.error) {
      setError(result.error.message);
    } else if (mode === 'signup' && !result.data?.session) {
      setMessage('Check your email to confirm your account, then come back to log in.');
      setMode('login');
    }
  };

  const useDemoCredentials = () => {
    setMode('login');
    setEmail(demoEmail);
    setPassword(demoPassword);
    setError('');
    setMessage('Demo credentials loaded. Press Log in to continue.');
  };
  
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
        <p className="text-zinc-400 font-medium mb-12 tracking-wide uppercase text-sm">
          Sign in to build your team
        </p>

        {(error || message) && (
          <div className={`mb-5 rounded-xl border p-3 text-sm font-bold ${error ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>
            {error || message}
          </div>
        )}

        <form onSubmit={handlePasswordAuth} className="space-y-4 text-left mb-6">
          <label className="block text-xs font-black uppercase tracking-widest text-zinc-500">Email
            <span className="relative mt-2 block"><Mail size={16} className="absolute left-4 top-4 text-zinc-600" /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className="w-full rounded-xl border border-white/10 bg-white/5 py-4 pl-11 pr-4 text-white outline-none focus:border-white/40" required /></span>
          </label>
          <label className="block text-xs font-black uppercase tracking-widest text-zinc-500">Password
            <span className="relative mt-2 block"><KeyRound size={16} className="absolute left-4 top-4 text-zinc-600" /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" className="w-full rounded-xl border border-white/10 bg-white/5 py-4 pl-11 pr-4 text-white outline-none focus:border-white/40" minLength={6} required /></span>
          </label>
          <button type="submit" disabled={loading} className="w-full rounded-xl bg-white py-4 font-black uppercase tracking-widest text-black transition-colors hover:bg-zinc-200 disabled:opacity-50">
            {loading ? 'Please wait...' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>

        <button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage(''); }} className="mb-8 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400 hover:text-white">
          <UserPlus size={14} /> {mode === 'login' ? 'Create a new account' : 'I already have an account'}
        </button>

        <button type="button" onClick={useDemoCredentials} disabled={loading} className="w-full rounded-xl border border-[#d9ff4a]/50 bg-[#d9ff4a]/10 py-4 text-sm font-black uppercase tracking-widest text-[#d9ff4a] transition-colors hover:bg-[#d9ff4a]/20 disabled:opacity-50">
          Use demo credentials
        </button>

        <div className="my-6 flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-zinc-600"><span className="h-px flex-1 bg-white/10" /> Or <span className="h-px flex-1 bg-white/10" /></div>

        <button type="button" onClick={signInWithGoogle} disabled={loading} className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/15 bg-white/5 py-4 text-sm font-black uppercase tracking-widest text-white transition-colors hover:bg-white/10 disabled:opacity-50">
          <LogIn size={17} /> Continue with Google
        </button>

        <p className="mt-8 text-xs text-zinc-600 uppercase tracking-widest font-black">
          Use your team captain email to continue
        </p>
      </GlassPanel>
    </div>
  );
}