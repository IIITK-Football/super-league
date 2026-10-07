import React, { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { Calendar, Swords } from 'lucide-react';
import { supabase } from '../../lib/supabase';
const API_URL = import.meta.env.VITE_API_URL || '/api';

export default function ScheduleMatches() {
  const [division, setDivision] = useState('mens');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ home_team_id: '', away_team_id: '', date: '', venue: '' });

  // Fetch teams specifically for the selected division!
  const { data: teamsResp } = useApi(`/teams?division=${division}`);
  const teams = teamsResp?.data || [];

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
        alert("Match Scheduled!");
        setForm({ home_team_id: '', away_team_id: '', date: '', venue: '' });
      } else {
        alert("Failed to schedule match.");
      }
    } catch (err) {
      alert("Failed to schedule match.");
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

          <button type="submit" disabled={loading} className="w-full bg-white text-black font-black uppercase tracking-widest py-4 rounded-xl hover:bg-zinc-200 transition-colors mt-4">
            {loading ? "Locking in Fixture..." : "Schedule Match"}
          </button>
        </form>
      </div>

    </div>
  );
}
