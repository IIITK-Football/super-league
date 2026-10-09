import React, { useState, useEffect } from 'react';
import { useApi } from '../../hooks/useApi';
import { API_BASE_URL } from '../../lib/api';
import { Activity, Trophy, CheckCircle, CheckCircle2, X, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export default function LiveController() {
  const [division, setDivision] = useState('mens');
  const { data: resp, refetch } = useApi(`/admin/matches?status=live,scheduled&division=${division}`);
  const { data: playersResp } = useApi('/players?all=true'); 
  
  const matches = resp?.data || [];
  const allPlayers = playersResp?.data || [];

  const [selectedMatch, setSelectedMatch] = useState(null);
  const [loading, setLoading] = useState(false);
  
  // --- MATCH CLOCK STATE ---
  const [liveMinute, setLiveMinute] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [displayTime, setDisplayTime] = useState('');

  // --- GOALS STATE ---
  const [goalsList, setGoalsList] = useState([]);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [goalForm, setGoalForm] = useState({ 
    id: null, team_id: '', player_id: '', assist_id: '', minute: '', is_own_goal: false 
  });

  // 1. Fetch Goals Function
  const fetchMatchGoals = async () => {
    if (!selectedMatch) return;
    const { data, error } = await supabase
      .from('goals')
      .select('*')
      .eq('match_id', selectedMatch.id)
      .order('id', { ascending: true });
    
    if (error) console.error("Error fetching goals:", error);
    if (!error && data) setGoalsList(data);
  };

  // 2. Initialize clock & Smart Resume when a match is clicked
  useEffect(() => {
    if (selectedMatch) {
      const dbMinute = selectedMatch.minute || "0'";
      setDisplayTime(dbMinute);
      const parsed = parseInt(dbMinute);
      setLiveMinute(isNaN(parsed) ? 0 : parsed);
      
      // Smart Timer Resume Logic
      if (selectedMatch.status === 'live' && dbMinute !== 'HT' && dbMinute !== 'FT') {
        setTimerRunning(true);
      } else {
        setTimerRunning(false); 
      }
      
      fetchMatchGoals(); 
    }
  }, [selectedMatch]);

  // 3. The Auto-Ticker! (Fires every 60 seconds)
  useEffect(() => {
    let interval;
    if (timerRunning) {
      interval = setInterval(() => {
        setLiveMinute(prev => {
          const next = prev + 1;
          syncTimeToDb(`${next}'`); 
          return next;
        });
      }, 60000); 
    }
    return () => clearInterval(interval);
  }, [timerRunning, selectedMatch]);

  // 4. Silent Sync Function
  const syncTimeToDb = async (timeStr) => {
    if (!selectedMatch) return;
    setDisplayTime(timeStr);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const API_URL = API_BASE_URL;
      await fetch(`${API_URL}/admin/matches/live`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ match_id: selectedMatch.id, action: 'update_time', minute: timeStr })
      });
    } catch (err) { console.error(err); }
  };

  const handleAction = async (action, extraData = {}) => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const API_URL = API_BASE_URL;
      const res = await fetch(`${API_URL}/admin/matches/live`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ match_id: selectedMatch.id, action, ...extraData })
      });
      
      const result = await res.json();
      if (result.success) {
        alert(result.message);
        refetch(); 
        fetchMatchGoals(); 
        setShowGoalForm(false); 
      } else {
        alert("Error: " + result.message);
      }
    } catch (err) { alert("Action failed. Check console."); } 
    finally { setLoading(false); }
  };

  const submitGoal = (e) => {
    e.preventDefault();
    handleAction('add_goal', goalForm);
  };

  const handleDeleteGoal = (goalId) => {
    if(confirm("Are you sure you want to delete this goal? This will adjust the score.")) {
      handleAction('delete_goal', { goal_id: goalId });
    }
  };

  const teamPlayers = allPlayers.filter(p => (p.team_id || p.teams?.id) === goalForm.team_id);

  const toggleOwnGoal = (e) => {
    const isOwn = e.target.checked;
    setGoalForm(prev => ({ ...prev, is_own_goal: isOwn, assist_id: isOwn ? '' : prev.assist_id }));
  };

  const handleDivisionSwitch = (newDiv) => {
    setDivision(newDiv);
    setSelectedMatch(null);
    setShowGoalForm(false);
  };

  const getPlayerName = (id) => {
    const player = allPlayers.find(p => p.id === id);
    return player ? `${player.first_name} ${player.last_name}` : 'Unknown Player';
  };

  return (
    <div className="p-6 space-y-8">
      
      <div className="flex justify-center mb-4">
        <div className="bg-black/50 p-1 rounded-full border border-white/10 flex">
          <button onClick={() => handleDivisionSwitch('mens')} className={`px-6 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-all ${division === 'mens' ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'}`}>Men's</button>
          <button onClick={() => handleDivisionSwitch('womens')} className={`px-6 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-all ${division === 'womens' ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'}`}>Women's</button>
          <button onClick={() => handleDivisionSwitch('freshers')} className={`px-6 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-all ${division === 'freshers' ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'}`}>Freshers</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {matches.length > 0 ? matches.map(m => (
          <button 
            key={m.id}
            onClick={() => { setSelectedMatch(m); setShowGoalForm(false); }}
            className={`p-4 rounded-xl border transition-all ${selectedMatch?.id === m.id ? 'border-white bg-white/10' : 'border-white/10 bg-black/40 hover:bg-white/5'}`}
          >
            <div className="flex justify-between text-xs uppercase font-black text-zinc-500 mb-2">
              <span>{m.division}</span>
              <span className={m.status === 'live' ? 'text-red-500 animate-pulse' : ''}>{m.status}</span>
            </div>
            <div className="font-bold text-lg">{m.home_team_name} vs {m.away_team_name}</div>
          </button>
        )) : (
          <div className="col-span-1 md:col-span-2 text-center py-12 border border-white/5 rounded-2xl bg-black/20">
            <span className="text-zinc-500 font-bold uppercase tracking-widest text-sm">No active or scheduled matches found</span>
          </div>
        )}
      </div>

      {selectedMatch && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 animate-in fade-in slide-in-from-bottom-4">
          <h3 className="text-center text-sm font-black uppercase tracking-widest text-zinc-500 mb-6">Control Center</h3>
          
          <div className="flex justify-center items-center gap-8 mb-10">
            <div className="text-center">
              <div className="text-4xl font-black">{selectedMatch.home_score}</div>
              <div className="text-xs font-bold text-zinc-400 uppercase mt-2">{selectedMatch.home_team_name}</div>
            </div>
            <div className="text-2xl font-black text-zinc-700">VS</div>
            <div className="text-center">
              <div className="text-4xl font-black">{selectedMatch.away_score}</div>
              <div className="text-xs font-bold text-zinc-400 uppercase mt-2">{selectedMatch.away_team_name}</div>
            </div>
          </div>

          <div className="bg-black/50 p-6 rounded-2xl border border-white/10 mb-8 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-white/5 pb-4">
              <h4 className="font-black uppercase tracking-widest text-sm text-zinc-400">Match Clock</h4>
              <div className="flex items-center gap-3">
                <span className={`text-4xl font-black tabular-nums ${timerRunning ? 'text-red-500 animate-pulse' : 'text-white'}`}>
                  {displayTime || `${liveMinute}'`}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {!timerRunning ? (
                <button type="button" onClick={() => { setTimerRunning(true); syncTimeToDb(`${liveMinute}'`); }} className="bg-white/10 hover:bg-white/20 text-white font-bold py-3 rounded-xl flex justify-center items-center gap-2 uppercase text-xs tracking-widest transition-colors">
                  ▶ Start
                </button>
              ) : (
                <button type="button" onClick={() => { setTimerRunning(false); syncTimeToDb(`${liveMinute}'`); }} className="bg-red-500/20 text-red-500 border border-red-500/50 hover:bg-red-500/30 font-bold py-3 rounded-xl flex justify-center items-center gap-2 uppercase text-xs tracking-widest transition-colors">
                  ⏸ Pause
                </button>
              )}
              <button type="button" onClick={() => { setTimerRunning(false); syncTimeToDb('HT'); }} className={`font-bold py-3 rounded-xl uppercase text-xs tracking-widest transition-colors border ${displayTime === 'HT' ? 'bg-yellow-500/20 text-yellow-500 border-yellow-500/50 hover:bg-yellow-500/30' : 'bg-white/10 text-white border-transparent hover:bg-white/20'}`}>
                Half Time
              </button>
              <div className="flex border border-white/10 rounded-xl overflow-hidden bg-black/60">
                <input type="number" value={liveMinute} onChange={e => setLiveMinute(parseInt(e.target.value) || 0)} className="w-full bg-transparent text-white text-center font-bold outline-none" />
                <button type="button" onClick={() => syncTimeToDb(`${liveMinute}'`)} className="bg-white/20 px-4 hover:bg-white/30 text-xs font-bold uppercase tracking-widest transition-colors">Set</button>
              </div>
            </div>
          </div>

          {showGoalForm ? (
            <form onSubmit={submitGoal} className="bg-black/50 border border-white/10 rounded-xl p-6 mb-6 space-y-4">
              <div className="flex justify-between items-center mb-4">
                <h4 className="font-black uppercase tracking-widest text-sm">Register Goal</h4>
                <button type="button" onClick={() => setShowGoalForm(false)} className="text-zinc-500 hover:text-white"><X size={18}/></button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={`block text-[10px] font-bold uppercase tracking-widest mb-2 ${goalForm.is_own_goal ? 'text-red-400' : 'text-zinc-500'}`}>
                    {goalForm.is_own_goal ? "Select Offending Team (Own Goal)" : "Select Scoring Team"}
                  </label>
                  <select required value={goalForm.team_id} onChange={e => setGoalForm({...goalForm, team_id: e.target.value, player_id: '', assist_id: ''})} className="w-full bg-white/5 border border-white/10 rounded-lg p-3 outline-none text-sm text-white">
                    <option value="" disabled className="bg-zinc-900 text-white">Select Team...</option>
                    <option value={selectedMatch.home_team_id} className="bg-zinc-900 text-white">{selectedMatch.home_team_name} (Home)</option>
                    <option value={selectedMatch.away_team_id} className="bg-zinc-900 text-white">{selectedMatch.away_team_name} (Away)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Minute</label>
                  <input type="text" required placeholder="e.g. 45" value={goalForm.minute} onChange={e => setGoalForm({...goalForm, minute: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-lg p-3 outline-none text-sm text-white" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Goal Type</label>
                  <select value={goalForm.is_own_goal ? 'own_goal' : 'regular'} onChange={e => { const isOwn = e.target.value === 'own_goal'; setGoalForm(prev => ({ ...prev, is_own_goal: isOwn, assist_id: isOwn ? '' : prev.assist_id })); }} className={`w-full bg-white/5 border rounded-lg p-3 outline-none text-sm font-bold ${goalForm.is_own_goal ? 'border-red-500/50 text-red-400' : 'border-white/10 text-white'}`}>
                    <option value="regular" className="bg-zinc-900 text-white">⚽ Regular Goal</option>
                    <option value="own_goal" className="bg-zinc-900 text-red-400">🔴 Own Goal</option>
                  </select>
                </div>
                <div>
                  <label className={`block text-[10px] font-bold uppercase tracking-widest mb-2 ${goalForm.is_own_goal ? 'text-red-400' : 'text-zinc-500'}`}>
                    {goalForm.is_own_goal ? "Player Who Scored Own Goal" : "Goalscorer"}
                  </label>
                  <select required disabled={!goalForm.team_id} value={goalForm.player_id} onChange={e => setGoalForm({...goalForm, player_id: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-lg p-3 outline-none text-sm text-white disabled:opacity-50">
                    <option value="" disabled className="bg-zinc-900 text-white">Select Player...</option>
                    {teamPlayers.map(p => <option key={p.id} value={p.id} className="bg-zinc-900 text-white">{p.first_name} {p.last_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Assist (Optional)</label>
                  <select disabled={!goalForm.team_id || goalForm.is_own_goal} value={goalForm.assist_id} onChange={e => setGoalForm({...goalForm, assist_id: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-lg p-3 outline-none text-sm text-white disabled:opacity-50">
                    <option value="" className="bg-zinc-900 text-white">{goalForm.is_own_goal ? "No Assists on Own Goals" : "No Assist (Solo)"}</option>
                    {teamPlayers.filter(p => p.id !== goalForm.player_id).map(p => <option key={p.id} value={p.id} className="bg-zinc-900 text-white">{p.first_name} {p.last_name}</option>)}
                  </select>
                </div>
              </div>
              <button type="submit" disabled={loading} className="w-full bg-white text-black font-black uppercase tracking-widest py-3 rounded-lg hover:bg-zinc-200 transition-colors mt-2">
                {loading ? "Saving..." : "Confirm Goal"}
              </button>
            </form>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button onClick={() => { setGoalForm({ id: null, team_id: '', player_id: '', assist_id: '', minute: '', is_own_goal: false }); setShowGoalForm(true); }} className="flex items-center justify-center gap-3 bg-white text-black py-4 rounded-xl font-black uppercase tracking-widest hover:bg-zinc-200 transition-colors">
                <Trophy size={18} /> Add Goal
              </button>
             <button 
                disabled={loading} 
                onClick={() => {
                  let hp = undefined;
                  let ap = undefined;
                  if (selectedMatch.home_score === selectedMatch.away_score && (division === 'womens' || division === 'freshers')) {
                    const hpStr = prompt(`Match is tied! Enter ${selectedMatch.home_team_name} (Home) Penalty Score (leave blank if not applicable):`);
                    const apStr = prompt(`Enter ${selectedMatch.away_team_name} (Away) Penalty Score (leave blank if not applicable):`);
                    if (hpStr && apStr) {
                      hp = parseInt(hpStr);
                      ap = parseInt(apStr);
                    }
                  }
                  if(confirm("End match and lock scores?")) { 
                    setTimerRunning(false); 
                    handleAction('close_match', { home_penalties: hp, away_penalties: ap }); 
                  } 
                }} 
                className="flex items-center justify-center gap-3 bg-red-600/20 text-red-500 border border-red-500/50 py-4 rounded-xl font-black uppercase tracking-widest hover:bg-red-600/30 transition-colors"
              >
                <CheckCircle2 size={18} /> Final Whistle
              </button>
                      </div>
          )}

          <div className="bg-black/50 p-6 rounded-2xl border border-white/10 mt-8 space-y-4 shadow-xl">
             <h4 className="font-black uppercase tracking-widest text-sm text-zinc-400 mb-2">Match Goals ({goalsList.length})</h4>
             <div className="space-y-3">
               {goalsList.length > 0 ? goalsList.map(goal => (
                 <div key={goal.id} className="flex justify-between items-center bg-white/5 p-4 rounded-xl border border-white/10">
                   <div>
                     <div className="text-sm font-bold text-white flex items-center gap-2">
                       <span className="text-zinc-500 w-8">{goal.minute}'</span> 
                       {getPlayerName(goal.player_id)} 
                       {goal.is_own_goal && <span className="text-[10px] bg-red-500/20 text-red-500 px-2 py-0.5 rounded-sm uppercase tracking-widest">Own Goal</span>}
                     </div>
                     {goal.assist_id && (
                       <div className="text-[11px] text-zinc-500 mt-1 ml-10">
                         Assist: {getPlayerName(goal.assist_id)}
                       </div>
                     )}
                   </div>
                   <div className="flex items-center gap-3 ml-4">
                     {/* The Edit button has been completely removed from here */}
                     <button onClick={() => handleDeleteGoal(goal.id)} className="text-zinc-600 hover:text-red-500 transition-colors" title="Delete">
                       <Trash2 size={16} />
                     </button>
                   </div>
                 </div>
               )) : (
                 <div className="text-center py-6 text-zinc-600 text-xs font-bold uppercase tracking-widest border border-dashed border-white/10 rounded-xl">
                   No goals registered yet.
                 </div>
               )}
             </div>
          </div>

        </div>
      )}
    </div>
  );
}
