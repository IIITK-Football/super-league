import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { GlassPanel } from '../components/GlassPanel';
import { Send, User } from 'lucide-react';

export function Onboarding() {
  const { user, profile, setProfile, signOut } = useAuth();
  const [nickname, setNickname] = useState(profile?.nickname || '');
  const [mensFlair, setMensFlair] = useState(profile?.mens_team_flair || '');
  const [womensFlair, setWomensFlair] = useState(profile?.womens_team_flair || '');
  const [wcFlair, setWcFlair] = useState(profile?.wc_team_flair || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  
  const [mensTeams, setMensTeams] = useState([]);
  const [womensTeams, setWomensTeams] = useState([]);
  const [wcTeams, setWcTeams] = useState([]);

  useEffect(() => {
    const fetchAllTeams = async () => {
      const { data } = await supabase.from('teams').select('*').order('name');
      if (data) {
        setMensTeams(data.filter(t => t.division === 'mens'));
        setWomensTeams(data.filter(t => t.division === 'womens'));
      }
      
      const fallbackWcTeams = [
        { id: 'ar', name: 'Argentina' }, { id: 'br', name: 'Brazil' },
        { id: 'fr', name: 'France' }, { id: 'es', name: 'Spain' },
        { id: 'de', name: 'Germany' }, { id: 'nl', name: 'Netherlands' },
        { id: 'gb-eng', name: 'England' }, { id: 'pt', name: 'Portugal' },
        { id: 'it', name: 'Italy' }, { id: 'uy', name: 'Uruguay' },
        { id: 'us', name: 'USA' }, { id: 'mx', name: 'Mexico' }
      ].sort((a, b) => a.name.localeCompare(b.name));

      try {
        const { data: wcData } = await supabase.from('wc_teams').select('*').order('name');
        if (wcData && wcData.length > 0) {
          setWcTeams(wcData);
        } else {
          setWcTeams(fallbackWcTeams);
        }
      } catch (e) {
        setWcTeams(fallbackWcTeams);
      }
    };
    fetchAllTeams();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!nickname.trim() || !mensFlair || !womensFlair || !wcFlair) return;
    
    setSaving(true);
    setError(null);

    try {
      const API_URL = import.meta.env.VITE_API_URL || '/api';
      const res = await fetch(`${API_URL}/wc/flair`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, wc_team_flair: wcFlair })
      });
      if (!res.ok) throw new Error('Failed to update World Cup flair via API');
    } catch (err) {
      console.error(err);
      setError("Failed to save World Cup profile. Are you sure you are online?");
      setSaving(false);
      return;
    }

    const updatedProfile = {
      id: user.id,
      email: user.email,
      nickname: nickname.trim(),
      mens_team_flair: mensFlair,
      womens_team_flair: womensFlair,
      team_flair_id: mensFlair,
      wc_team_flair: wcFlair
    };

    // 1. USE UPSERT: This guarantees it saves
    const { error: updateError } = await supabase
      .from('user_profiles')
      .upsert(updatedProfile);

    if (updateError) {
      console.error("Profile saving error:", updateError.message);
      setError("Failed to save profile. Are you sure you are online?");
      setSaving(false);
      return;
    }

    // 2. Update local state
    setProfile({ ...profile, id: user.id, email: user.email, ...updatedProfile });
    
    // 3. THE URL RESCUE: Force them out of the ?view=onboarding URL!
    window.location.href = '/'; 
  };

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4 relative overflow-hidden">
      {/* Sharp FIFA Theme Background Shapes */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-[#00c3e3]/20 rotate-45 origin-top-right blur-[80px] -z-10 mix-blend-screen" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[800px] bg-[#00c3e3]/10 -rotate-45 origin-bottom-left blur-[60px] -z-10 mix-blend-screen" />
      <div className="absolute top-1/2 left-1/4 w-[200px] h-[200px] bg-white/5 rotate-12 blur-[40px] -z-10" />

      <GlassPanel className="max-w-3xl w-full p-8 text-center relative z-10 border border-[#00c3e3]/20 bg-black/60 backdrop-blur-2xl">
        <User className="w-12 h-12 text-[#00c3e3] mx-auto mb-6" />
        <h1 className="text-3xl font-black uppercase tracking-tighter mb-2 text-transparent bg-clip-text bg-gradient-to-r from-white to-[#00c3e3]">
          Welcome to Super League
        </h1>
        <p className="text-zinc-400 font-medium mb-8 text-sm">
          You logged in with {user.email}. Complete your profile to access predictions and leaderboards.
        </p>

        {error && (
          <div className="bg-red-500/20 border border-red-500/50 text-red-200 p-3 rounded-lg mb-6 text-sm font-bold">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6 text-left">
          <div>
            <label className="block text-xs font-black uppercase tracking-widest text-zinc-500 mb-2 ml-1">
              Choose Nickname
            </label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="e.g. MasterPredictor99"
              className="w-full bg-black/50 border border-white/10 rounded-xl px-5 py-4 text-white font-bold placeholder-zinc-700 outline-none focus:border-white/40 transition-colors"
              required
              maxLength={20}
              minLength={3}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2 ml-1">
                Men's Team Flair
              </label>
              <select
                value={mensFlair}
                onChange={(e) => setMensFlair(e.target.value)}
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-white font-bold outline-none focus:border-[#00c3e3]/40 transition-colors appearance-none cursor-pointer"
                required
              >
                <option value="" disabled>Select Club...</option>
                {mensTeams.map((t) => <option key={t.id} value={t.name} className="bg-zinc-900">{t.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2 ml-1">
                Women's Team Flair
              </label>
              <select
                value={womensFlair}
                onChange={(e) => setWomensFlair(e.target.value)}
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-white font-bold outline-none focus:border-[#00c3e3]/40 transition-colors appearance-none cursor-pointer"
                required
              >
                <option value="" disabled>Select Club...</option>
                {womensTeams.map((t) => <option key={t.id} value={t.name} className="bg-zinc-900">{t.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2 ml-1">
                World Cup Flair
              </label>
              <select
                value={wcFlair}
                onChange={(e) => setWcFlair(e.target.value)}
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-white font-bold outline-none focus:border-[#00c3e3]/40 transition-colors appearance-none cursor-pointer"
                required
              >
                <option value="" disabled>Select Country...</option>
                {wcTeams.map((t) => <option key={t.id} value={t.name} className="bg-zinc-900">{t.name}</option>)}
              </select>
            </div>
          </div>

          <button
            type="submit"
            disabled={saving || !nickname || !mensFlair || !womensFlair || !wcFlair}
            className="w-full group h-14 bg-[#00c3e3] text-black hover:bg-[#00e5ff] rounded-xl font-bold uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-2 mt-4 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Enter The League"}
            <Send className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
        </form>

        <button 
          onClick={() => signOut()}
          className="mt-8 text-xs text-zinc-600 hover:text-white uppercase tracking-widest font-bold transition-colors"
        >
          Cancel & Log Out
        </button>
      </GlassPanel>
    </div>
  );
}