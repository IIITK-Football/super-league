import React, { useState } from 'react';
import { Shield, Key } from 'lucide-react';
import { GlassPanel } from '../components/GlassPanel';
import { supabase } from '../lib/supabase'; // Or use your API route!
import { COLLEGE_EMAIL_MESSAGE, isCollegeEmail } from '../lib/authRules';
import { TurnstileWidget, turnstileSiteKey } from '../components/TurnstileWidget';

export function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [captchaToken, setCaptchaToken] = useState(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!isCollegeEmail(email)) {
      setError(COLLEGE_EMAIL_MESSAGE);
      setLoading(false);
      return;
    }

    // Turnstile is verified by Supabase Auth; here we only make sure it was completed.
    if (turnstileSiteKey() && !captchaToken) {
      setError('Please complete the verification first.');
      setLoading(false);
      return;
    }

    // Using Supabase client directly to instantly update your AuthContext session
    const credentials = { email: email.trim(), password };
    if (captchaToken) credentials.options = { captchaToken };
    const { error } = await supabase.auth.signInWithPassword(credentials);

    // Tokens are single-use: ask for a fresh one after every attempt.
    setCaptchaToken(null);
    setCaptchaReset((n) => n + 1);

    if (error) {
      setError(/captcha/i.test(error.message || '') ? 'The verification did not complete. Please try the verification again.' : "Invalid admin credentials.");
      setLoading(false);
    } else {
      // Success! Redirect to the dashboard
      window.location.href = '/admin'; 
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <GlassPanel className="max-w-md w-full p-10 border border-white/10 bg-black/80">
        <div className="flex justify-center mb-6">
          <Shield className="w-16 h-16 text-zinc-500" />
        </div>
        <h1 className="text-3xl font-black text-center text-white uppercase tracking-widest mb-8">
          Command Access
        </h1>
        
        {error && (
          <div className="bg-red-500/20 text-red-400 p-3 rounded-lg mb-6 text-sm font-bold text-center border border-red-500/30">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label htmlFor="hq-email" className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Admin Email</label>
            <input
              id="hq-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-white outline-none focus:border-white/30"
              required
            />
          </div>
          <div>
            <label htmlFor="hq-passcode" className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Passcode</label>
            <input
              id="hq-passcode"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-white outline-none focus:border-white/30"
              required
            />
          </div>
          <TurnstileWidget onToken={setCaptchaToken} resetKey={captchaReset} />
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-white text-black font-black uppercase tracking-widest py-4 rounded-xl flex justify-center items-center gap-2 hover:bg-zinc-200 transition-colors disabled:opacity-50"
          >
            {loading ? "Authenticating..." : <><Key size={18} /> Authorize</>}
          </button>
        </form>
      </GlassPanel>
    </div>
  );
}