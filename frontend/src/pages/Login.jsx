import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { GlassPanel } from '../components/GlassPanel';
import { ArrowLeft, LogIn } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';

export function Login() {
  const { signInWithGoogle, role, loading, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // 1. Grab the intended destination (defaults to "/")
  const from = location.state?.from?.pathname || "/team-builder";

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
          Sign in with Google to continue
        </p>
        <button type="button" onClick={signInWithGoogle} disabled={loading} className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/15 bg-white/5 py-4 text-sm font-black uppercase tracking-widest text-white transition-colors hover:bg-white/10 disabled:opacity-50">
          <LogIn size={17} /> Continue with Google
        </button>

        <p className="mt-8 text-xs text-zinc-600 uppercase tracking-widest font-black">
          Use your college email to continue
        </p>
      </GlassPanel>
    </div>
  );
}
