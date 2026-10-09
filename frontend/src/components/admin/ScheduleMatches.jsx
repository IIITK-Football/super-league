import React, { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { API_BASE_URL } from '../../lib/api';
import { Calendar, Swords } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { WomensBracket, FreshersBracket } from '../../pages/Standings';
const API_URL = API_BASE_URL;

export default function ScheduleMatches() {
  const [division, setDivision] = useState('mens');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ home_team_id: '', away_team_id: '', date: '', venue: '', is_walkover: false, walkover_winner: '' });

  // Fetch teams specifically for the selected division!
  const { data: teamsResp } = useApi(`/teams?division=${division}`);
  const teams = teamsResp?.data || [];

  // Fetch the current standings/schedule data to display the bracket preview
  const { data: standingsResp } = useApi(`/standings?division=${division}`);
  const bracketMatches = standingsResp?.data?.bracketMatches || [];

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.home_team_id === form.away_team_id) {
      return alert("A team cannot play against itself!");
    }

    setLoading(true);
    try {
      // 1. Grab the VIP Pass (Auth Token)
      const { data: { session } } = await supabase.auth.getSession();

      // 2. Fix the URL and add the Auth Headers!
      const res = await fetch(`${API_URL}/admin/matches`, { 
        method: 'POST',
        credentials: 'include', 
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}` 
        },
        body: JSON.stringify({ ...form, division })
      });
      
      if (res.ok) {
        alert("Match Scheduled" + (form.is_walkover ? " as a Walkover!" : "!"));
        setForm({ home_team_id: '', away_team_id: '', date: '', venue: '', is_walkover: false, walkover_winner: '' });
      } else {
        const errorData = await res.json();
        alert(`Failed to schedule match: ${errorData.message || 'Unknown error'}`);
      }
    } catch (err) {
      alert(`Failed to schedule match: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-8 animate-in fade-in duration-500">
      
      {/* LEAGUE TOGGLE */}
      <div className="flex justify-center mb-8">
        <div className="bg-black/50 p-1 rounded-full border border-white/10 flex">
          <button onClick={() => setDivision('mens')} className={`px-6 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-all ${division === 'mens' ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'}`}>Men's League</button>
          <button onClick={() => setDivision('womens')} className={`px-6 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-all ${division === 'womens' ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'}`}>Women's League</button>
          <button onClick={() => setDivision('freshers')} className={`px-6 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-all ${division === 'freshers' ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'}`}>Freshers</button>
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-2xl p-8 max-w-2xl mx-auto">
        <h3 className="text-xl font-black uppercase tracking-widest text-white mb-6 flex items-center gap-3 justify-center">
          <Calendar size={24} className="text-zinc-500" /> Fixture Generator
        </h3>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="flex items-center gap-4">
            {/* HOME TEAM SELECT */}
            <div className="flex-1">
              <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Home Team</label>
              <select required value={form.home_team_id} onChange={e => setForm({...form, home_team_id: e.target.value})} className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-white/30 appearance-none text-white">
                <option value="" disabled className="bg-zinc-900 text-white">Select Home Team...</option>
                {teams.map(t => <option key={t.id} value={t.id} className="bg-zinc-900 text-white">{t.name}</option>)}
              </select>
            </div>
            
            <div className="pt-6">
              <Swords className="text-zinc-600 w-8 h-8" />
            </div>
            
            {/* AWAY TEAM SELECT */}
            <div className="flex-1">
              <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Away Team</label>
              <select required value={form.away_team_id} onChange={e => setForm({...form, away_team_id: e.target.value})} className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-white/30 appearance-none text-white">
                <option value="" disabled className="bg-zinc-900 text-white">Select Away Team...</option>
                {teams.map(t => <option key={t.id} value={t.id} className="bg-zinc-900 text-white">{t.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* DATE INPUT (Fixed with color-scheme:dark) */}
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Kickoff Date & Time</label>
              <input type="datetime-local" required value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-white/30 text-white [color-scheme:dark]" />
            </div>
            
            {/* VENUE INPUT */}
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Venue / Pitch</label>
              <input type="text" placeholder="e.g. Main Turf" required value={form.venue} onChange={e => setForm({...form, venue: e.target.value})} className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-white/30 text-white" />
            </div>
          </div>

          {/* WALKOVER SETTINGS */}
          <div className="bg-black/30 border border-white/5 rounded-xl p-4 space-y-4">
            <div className="flex items-center gap-3">
              <input 
                type="checkbox" 
                id="walkover-toggle"
                checked={form.is_walkover}
                onChange={(e) => setForm({...form, is_walkover: e.target.checked, walkover_winner: e.target.checked ? 'home' : ''})}
                className="w-4 h-4 accent-white"
              />
              <label htmlFor="walkover-toggle" className="text-sm font-bold text-white uppercase tracking-widest cursor-pointer">Register as Walkover (Instant 3-0 Win)</label>
            </div>
            
            {form.is_walkover && (
              <div className="animate-in fade-in slide-in-from-top-2 pt-2 border-t border-white/5">
                <label className="block text-xs font-bold text-red-400 uppercase tracking-widest mb-2">Who gets the 3-0 Win?</label>
                <select 
                  required={form.is_walkover}
                  value={form.walkover_winner} 
                  onChange={e => setForm({...form, walkover_winner: e.target.value})} 
                  className="w-full bg-red-950/30 border border-red-500/30 rounded-xl px-4 py-3 outline-none focus:border-red-500/50 appearance-none text-red-200"
                >
                  <option value="" disabled>Select the Winner...</option>
                  <option value="home">Home Team (Left)</option>
                  <option value="away">Away Team (Right)</option>
                </select>
              </div>
            )}
          </div>

          <button type="submit" disabled={loading} className="w-full bg-white text-black font-black uppercase tracking-widest py-4 rounded-xl hover:bg-zinc-200 transition-colors mt-4">
            {loading ? (form.is_walkover ? "Registering Walkover..." : "Locking in Fixture...") : (form.is_walkover ? "Register Walkover" : "Schedule Match")}
          </button>
        </form>
      </div>

      {/* RENDER THE SCHEDULE MAP FOR BRACKET DIVISIONS */}
      {(division === 'womens' || division === 'freshers') && (
        <div className="mt-16 pt-8 border-t border-white/10">
          <div className="text-center mb-8">
            <h3 className="text-sm font-black text-zinc-500 uppercase tracking-widest mb-2">Live Preview</h3>
            <p className="text-xs text-zinc-400">This is how the bracket will look to the public based on the chronologically scheduled dates.</p>
          </div>
          
          <div className="opacity-90 scale-95 origin-top">
            {division === 'womens' ? (
              <WomensBracket matches={bracketMatches} title="Bracket Preview" buttonText="Current mapping of slots" />
            ) : (
              <FreshersBracket matches={bracketMatches} title="Bracket Preview" buttonText="Current mapping of slots" />
            )}
          </div>
        </div>
      )}

    </div>
  );
}
