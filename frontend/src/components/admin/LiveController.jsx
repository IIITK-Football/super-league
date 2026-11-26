import React, { useState, useEffect } from 'react';
import { useApi } from '../../hooks/useApi';
import { API_BASE_URL } from '../../lib/api';
import { Activity, Trophy, CheckCircle, CheckCircle2, X, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { DivisionSwitch } from './DivisionSwitch';
import { useAuth } from '../../context/AuthContext';

export default function LiveController() {
  const { hasRole } = useAuth();
  const [division, setDivision] = useState('super-league');
  const { data: resp, refetch } = useApi(`/admin/matches?status=live,scheduled&division=${division}`);
  const { data: playersResp } = useApi(`/players?division=${division}`); // the selected division's current season roster 
  
  const matches = resp?.data || [];
  const allPlayers = playersResp?.data || [];

  const [selectedMatch, setSelectedMatch] = useState(null);
  const [loading, setLoading] = useState(false);
  
  // --- MATCH CLOCK STATE ---
  const [liveMinute, setLiveMinute] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [displayTime, setDisplayTime] = useState('');
  const [calibration, setCalibration] = useState(0);

  // --- MATCH EVENTS STATE (goals, own goals and cards; the score is a cache of them, never typed in) ---
  const [events, setEvents] = useState([]);
  const [eventsState, setEventsState] = useState({ status: 'idle', error: '' });
  const [notice, setNotice] = useState({ type: '', text: '' });
  const [busyId, setBusyId] = useState('');
  const [candidates, setCandidates] = useState(null); // goals to choose from when -1 has no unattributed goal
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [showCardForm, setShowCardForm] = useState(false);
  const [goalForm, setGoalForm] = useState({
    id: null, editId: null, version: null, team_id: '', player_id: '', assist_id: '', minute: '', is_own_goal: false
  });
  const [cardForm, setCardForm] = useState({ id: null, kind: 'yellow', team_id: '', player_id: '', minute: '' });

  // 1. Fetch the match's events (voided events are corrections and stay out of the list)
  const fetchMatchEvents = async () => {
    if (!selectedMatch) return;
    setEventsState({ status: 'loading', error: '' });
    const { data, error } = await supabase
      .from('match_events')
      .select('id, team_id, kind, player_id, assist_player_id, minute, added_minute, version')
      .eq('match_id', selectedMatch.id)
      .is('voided_at', null)
      .order('minute', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    if (error) { setEventsState({ status: 'error', error: error.message }); return; }
    setEvents(data || []);
    setEventsState({ status: 'ready', error: '' });
  };

  // 2. Initialize clock & Smart Resume when a match is clicked
  useEffect(() => {
    if (selectedMatch) {
      const dbMinute = selectedMatch.minute || "0'";
      setDisplayTime(dbMinute);
      const parsed = parseInt(dbMinute);
      
      // Timer state from backend instead of local storage
      const savedStart = selectedMatch.timer_start_time ? new Date(selectedMatch.timer_start_time).getTime() : null;
      const savedCalib = selectedMatch.timer_calibration !== undefined && selectedMatch.timer_calibration !== null 
                           ? selectedMatch.timer_calibration 
                           : (isNaN(parsed) ? 0 : parsed);
                           
      setCalibration(savedCalib);
      
      // Smart Timer Resume Logic
      if (selectedMatch.status === 'live' && dbMinute !== 'HT' && dbMinute !== 'FT') {
        if (!savedStart && timerRunning === false) {
           // We'll let the user hit start.
        } else if (savedStart) {
           setTimerRunning(true);
        }
      } else {
        setTimerRunning(false); 
      }
      
      fetchMatchEvents(); 
    }
  }, [selectedMatch?.id]);

  // 3. The Auto-Ticker! (Fires every second to compute elapsed time)
  useEffect(() => {
    let interval;
    if (timerRunning && selectedMatch && selectedMatch.timer_start_time) {
      interval = setInterval(() => {
        const startTime = new Date(selectedMatch.timer_start_time).getTime();
        const elapsedMinutes = Math.floor((Date.now() - startTime) / 60000);
        const currentCalib = selectedMatch.timer_calibration || 0;
        
        const next = elapsedMinutes + currentCalib;
        setLiveMinute(next);
        
        // Only sync display string every 60 seconds (but do not ping DB)
        setDisplayTime(prev => {
          return `${next}'`;
        });
      }, 1000); 
    }
    return () => clearInterval(interval);
  }, [timerRunning, selectedMatch]);

  // 4. Silent Sync Function
  const syncTimeToDb = async (timeStr, startTime = undefined, calib = undefined) => {
    if (!selectedMatch) return;
    if (timeStr) setDisplayTime(timeStr);
    
    const payload = { match_id: selectedMatch.id, action: 'update_time', minute: timeStr };
    if (startTime !== undefined) payload.timer_start_time = startTime;
    if (calib !== undefined) payload.timer_calibration = calib;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const API_URL = API_BASE_URL;
      await fetch(`${API_URL}/admin/matches/live`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify(payload)
      });
    } catch (err) { console.error(err); }
  };

  // One call to the live route. A response carries the match's fresh score (a cache of its events) and the event.
  const callLive = async (payload) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${API_BASE_URL}/admin/matches/live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
      body: JSON.stringify({ match_id: selectedMatch.id, ...payload })
    });
    const result = await res.json().catch(() => ({ success: false, message: 'Unexpected response from the server.' }));
    if (result.match) setSelectedMatch((prev) => ({ ...prev, ...result.match }));
    return { ok: res.ok && result.success, status: res.status, ...result };
  };

  // Records, corrects or voids an event, then reloads the list. A 409 (a stale version, or "choose the goal") is
  // explained inline and the list is refreshed, so the scorer sees what changed.
  const runEvent = async (payload, busy = 'form') => {
    setBusyId(busy);
    setNotice({ type: '', text: '' });
    try {
      const r = await callLive(payload);
      if (r.ok) {
        setNotice({ type: 'ok', text: r.message });
        setCandidates(null);
        setShowGoalForm(false);
        setShowCardForm(false);
        refetch();
      } else {
        if (r.status === 409 && r.candidates) setCandidates(r.candidates);
        setNotice({ type: 'error', text: r.message || 'The change was not saved.' });
      }
      await fetchMatchEvents();
      return r;
    } catch (err) {
      setNotice({ type: 'error', text: 'The change was not saved. Check your connection and try again.' });
    } finally { setBusyId(''); }
  };

  // Clock and status actions (half time, final whistle) keep their confirmations.
  const handleAction = async (action, extraData = {}) => {
    setLoading(true);
    try {
      const r = await callLive({ action, ...extraData });
      if (r.ok) { setNotice({ type: 'ok', text: r.message }); refetch(); }
      else setNotice({ type: 'error', text: r.message || 'The action failed.' });
    } catch (err) { setNotice({ type: 'error', text: 'Action failed. Check your connection.' }); }
    finally { setLoading(false); }
  };

  const submitGoal = (e) => {
    e.preventDefault();
    const base = { kind: goalForm.is_own_goal ? 'own_goal' : 'goal', team_id: goalForm.team_id, player_id: goalForm.player_id || null,
      assist_player_id: goalForm.is_own_goal ? null : (goalForm.assist_id || null), minute: goalForm.minute || null };
    if (goalForm.editId) runEvent({ action: 'edit_event', event_id: goalForm.editId, version: goalForm.version, changes: base }, goalForm.editId);
    else runEvent({ action: 'add_event', event: { id: goalForm.id, ...base } });
  };

  const submitCard = (e) => {
    e.preventDefault();
    runEvent({ action: 'add_event', event: { id: cardForm.id, kind: cardForm.kind, team_id: cardForm.team_id, player_id: cardForm.player_id, minute: cardForm.minute || null } });
  };

  const openGoalForm = (event = null) => {
    setShowCardForm(false);
    setGoalForm(event
      ? { id: null, editId: event.id, version: event.version, team_id: event.team_id, player_id: event.player_id || '', assist_id: event.assist_player_id || '', minute: event.minute ?? '', is_own_goal: event.kind === 'own_goal' }
      : { id: crypto.randomUUID(), editId: null, version: null, team_id: '', player_id: '', assist_id: '', minute: '', is_own_goal: false });
    setShowGoalForm(true);
  };

  const voidEvent = (event) => {
    const reason = prompt('Why is this event being removed? (a reason is required)');
    if (!reason || !reason.trim()) return;
    runEvent({ action: 'void_event', event_id: event.id, version: event.version, reason: reason.trim() }, event.id);
  };

  const scoreStep = (side, delta) => runEvent({ action: 'score_step', side, delta, id: crypto.randomUUID() }, `${side}${delta}`);

  const unattributedCount = events.filter((e) => e.kind === 'goal' && !e.player_id).length;
  const eventLabel = (e) => (e.player_id ? getPlayerName(e.player_id) : e.kind === 'goal' || e.kind === 'own_goal' ? 'Unknown scorer' : 'Unknown player');

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
        <DivisionSwitch value={division} onChange={handleDivisionSwitch} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {matches.length > 0 ? matches.map(m => (
          <button 
            key={m.id}
            onClick={() => { setSelectedMatch(m); setShowGoalForm(false); }}
            className={`p-4 rounded-xl border transition-all ${selectedMatch?.id === m.id ? 'border-white bg-white/10' : 'border-white/10 bg-black/40 hover:bg-white/5'}`}
          >
            <div className="flex justify-between text-xs uppercase font-black text-zinc-500 mb-2">
              <span>{m.division_name} {m.season_name}</span>
              <span className={m.status === 'live' ? 'text-red-500 animate-pulse' : ''}>{m.status}</span>
            </div>
            <div className="font-bold text-lg">{m.home_team_name} vs {m.away_team_name}</div>
          </button>
        )) : (
          <div className="col-span-1 md:col-span-2 text-center py-12 border border-white/5 rounded-2xl bg-black/20">
            <span className="text-zinc-500 font-bold uppercase tracking-widest text-sm">
              {hasRole('dictator') ? 'No active or scheduled matches found' : 'No matches assigned to you in this division'}
            </span>
          </div>
        )}
      </div>

      {selectedMatch && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 animate-in fade-in slide-in-from-bottom-4">
          <h3 className="text-center text-sm font-black uppercase tracking-widest text-zinc-500 mb-6">Control Center</h3>
          
          <div className="flex justify-center items-center gap-8 mb-10">
            <div className="text-center">
              <div className="text-4xl font-black" aria-label="Home score">{selectedMatch.home_score}</div>
              <div className="text-xs font-bold text-zinc-400 uppercase mt-2">{selectedMatch.home_team_name}</div>
              <div className="mt-3 flex justify-center gap-2">
                <button type="button" disabled={busyId !== ''} onClick={() => scoreStep('home', 1)} className="rounded-lg bg-white/10 px-3 py-1 text-xs font-black hover:bg-white/20 disabled:opacity-40">+1 Home</button>
                <button type="button" disabled={busyId !== ''} onClick={() => scoreStep('home', -1)} className="rounded-lg bg-white/10 px-3 py-1 text-xs font-black hover:bg-white/20 disabled:opacity-40" aria-label="Minus one home">−1</button>
              </div>
            </div>
            <div className="text-2xl font-black text-zinc-700">VS</div>
            <div className="text-center">
              <div className="text-4xl font-black" aria-label="Away score">{selectedMatch.away_score}</div>
              <div className="text-xs font-bold text-zinc-400 uppercase mt-2">{selectedMatch.away_team_name}</div>
              <div className="mt-3 flex justify-center gap-2">
                <button type="button" disabled={busyId !== ''} onClick={() => scoreStep('away', 1)} className="rounded-lg bg-white/10 px-3 py-1 text-xs font-black hover:bg-white/20 disabled:opacity-40">+1 Away</button>
                <button type="button" disabled={busyId !== ''} onClick={() => scoreStep('away', -1)} className="rounded-lg bg-white/10 px-3 py-1 text-xs font-black hover:bg-white/20 disabled:opacity-40" aria-label="Minus one away">−1</button>
              </div>
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
                <button type="button" onClick={() => { 
                  const startIso = new Date().toISOString();
                  setTimerRunning(true); 
                  syncTimeToDb(`${calibration}'`, startIso, calibration);
                  // Optimistically update local selectedMatch to prevent jump
                  setSelectedMatch(prev => ({ ...prev, timer_start_time: startIso, timer_calibration: calibration }));
                }} className="bg-white/10 hover:bg-white/20 text-white font-bold py-3 rounded-xl flex justify-center items-center gap-2 uppercase text-xs tracking-widest transition-colors">
                  ▶ Start
                </button>
              ) : (
                <button type="button" onClick={() => { 
                  setTimerRunning(false); 
                  // Update calibration to lock the time
                  const startTime = selectedMatch.timer_start_time ? new Date(selectedMatch.timer_start_time).getTime() : Date.now();
                  const elapsed = Math.floor((Date.now() - startTime) / 60000);
                  const newCalib = elapsed + calibration;
                  setCalibration(newCalib);
                  syncTimeToDb(`${newCalib}'`, null, newCalib); 
                  setSelectedMatch(prev => ({ ...prev, timer_start_time: null, timer_calibration: newCalib }));
                }} className="bg-red-500/20 text-red-500 border border-red-500/50 hover:bg-red-500/30 font-bold py-3 rounded-xl flex justify-center items-center gap-2 uppercase text-xs tracking-widest transition-colors">
                  ⏸ Pause
                </button>
              )}
              <button type="button" onClick={() => {
                  // Keep the minutes played (as Pause does) so the second half resumes from them.
                  const startTime = selectedMatch.timer_start_time ? new Date(selectedMatch.timer_start_time).getTime() : null;
                  const newCalib = timerRunning && startTime ? Math.floor((Date.now() - startTime) / 60000) + calibration : calibration;
                  setTimerRunning(false);
                  setCalibration(newCalib);
                  syncTimeToDb('HT', null, newCalib);
                  setSelectedMatch(prev => ({ ...prev, timer_start_time: null, timer_calibration: newCalib }));
              }} className={`font-bold py-3 rounded-xl uppercase text-xs tracking-widest transition-colors border ${displayTime === 'HT' ? 'bg-yellow-500/20 text-yellow-500 border-yellow-500/50 hover:bg-yellow-500/30' : 'bg-white/10 text-white border-transparent hover:bg-white/20'}`}>
                Half Time
              </button>
              <div className="flex border border-white/10 rounded-xl overflow-hidden bg-black/60">
                <input 
                  type="number" 
                  value={calibration} 
                  onChange={e => {
                    const val = parseInt(e.target.value) || 0;
                    setCalibration(val);
                    // If not running, immediately show the updated calibration
                    if (!timerRunning) {
                       setLiveMinute(val);
                       setDisplayTime(`${val}'`);
                    }
                  }} 
                  className="w-full bg-transparent text-white text-center font-bold outline-none" 
                  placeholder="Calib"
                />
                <button type="button" onClick={() => {
                  syncTimeToDb(timerRunning ? undefined : `${calibration}'`, undefined, calibration);
                  setSelectedMatch(prev => ({ ...prev, timer_calibration: calibration }));
                }} className="bg-white/20 px-4 hover:bg-white/30 text-xs font-bold uppercase tracking-widest transition-colors">Set</button>
              </div>
            </div>
          </div>

          {notice.text && <p role={notice.type === 'error' ? 'alert' : 'status'} className={`mb-4 rounded-lg border p-3 text-sm ${notice.type === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>{notice.text}</p>}
          {unattributedCount > 0 && <p role="note" className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">{unattributedCount} goal{unattributedCount === 1 ? '' : 's'} unattributed: choose Attribute on the goal to add its scorer. They count toward the score and toward no player.</p>}
          {candidates && <div role="group" aria-label="Choose the goal to correct" className="mb-4 space-y-2 rounded-xl border border-white/10 bg-black/50 p-4">
            <p className="text-xs font-black uppercase tracking-widest text-zinc-400">Which goal should be removed?</p>
            {candidates.map((c) => <div key={c.id} className="flex items-center justify-between rounded-lg bg-white/5 p-3 text-sm">
              <span>{c.minute ?? '?'}' · {eventLabel(c)}</span>
              <button type="button" onClick={() => voidEvent(c)} className="text-xs font-black uppercase tracking-widest text-red-400">Void this goal</button>
            </div>)}
            <button type="button" onClick={() => setCandidates(null)} className="text-xs text-zinc-500 underline">Cancel</button>
          </div>}

          {showCardForm && <form onSubmit={submitCard} className="bg-black/50 border border-white/10 rounded-xl p-6 mb-6 space-y-4">
            <div className="flex justify-between items-center"><h4 className="font-black uppercase tracking-widest text-sm">Add Card</h4><button type="button" onClick={() => setShowCardForm(false)} className="text-zinc-500 hover:text-white"><X size={18}/></button></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <select aria-label="Card colour" value={cardForm.kind} onChange={e => setCardForm({ ...cardForm, kind: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-sm text-white"><option value="yellow" className="bg-zinc-900">Yellow card</option><option value="red" className="bg-zinc-900">Red card</option></select>
              <input type="text" aria-label="Card minute" placeholder="Minute" value={cardForm.minute} onChange={e => setCardForm({ ...cardForm, minute: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-sm text-white" />
              <select aria-label="Card team" required value={cardForm.team_id} onChange={e => setCardForm({ ...cardForm, team_id: e.target.value, player_id: '' })} className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-sm text-white"><option value="" className="bg-zinc-900">Select team...</option><option value={selectedMatch.home_team_id} className="bg-zinc-900">{selectedMatch.home_team_name} (Home)</option><option value={selectedMatch.away_team_id} className="bg-zinc-900">{selectedMatch.away_team_name} (Away)</option></select>
              <select aria-label="Carded player" required disabled={!cardForm.team_id} value={cardForm.player_id} onChange={e => setCardForm({ ...cardForm, player_id: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-sm text-white"><option value="" className="bg-zinc-900">Select player...</option>{allPlayers.filter(p => (p.team_id || p.teams?.id) === cardForm.team_id).map(p => <option key={p.id} value={p.id} className="bg-zinc-900">{p.first_name} {p.last_name}</option>)}</select>
            </div>
            <button type="submit" disabled={busyId !== ''} className="w-full bg-white text-black font-black uppercase tracking-widest py-3 rounded-lg disabled:opacity-40">{busyId !== '' ? 'Saving...' : 'Confirm Card'}</button>
          </form>}

          {showGoalForm ? (
            <form onSubmit={submitGoal} className="bg-black/50 border border-white/10 rounded-xl p-6 mb-6 space-y-4">
              <div className="flex justify-between items-center mb-4">
                <h4 className="font-black uppercase tracking-widest text-sm">{goalForm.editId ? 'Correct Goal' : 'Register Goal'}</h4>
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
                  <input type="text" placeholder="e.g. 45" aria-label="Minute" value={goalForm.minute} onChange={e => setGoalForm({...goalForm, minute: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-lg p-3 outline-none text-sm text-white" />
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
                  <select aria-label="Goalscorer" disabled={!goalForm.team_id} value={goalForm.player_id} onChange={e => setGoalForm({...goalForm, player_id: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-lg p-3 outline-none text-sm text-white disabled:opacity-50">
                    <option value="" className="bg-zinc-900 text-white">Scorer not known yet</option>
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
              <button type="submit" disabled={busyId !== ''} className="w-full bg-white text-black font-black uppercase tracking-widest py-3 rounded-lg hover:bg-zinc-200 transition-colors mt-2">
                {busyId !== '' ? "Saving..." : goalForm.editId ? "Save correction" : "Confirm Goal"}
              </button>
            </form>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button onClick={() => { setCardForm({ id: crypto.randomUUID(), kind: 'yellow', team_id: '', player_id: '', minute: '' }); setShowGoalForm(false); setShowCardForm(true); }} className="flex items-center justify-center gap-3 bg-yellow-500/10 text-yellow-300 border border-yellow-500/30 py-4 rounded-xl font-black uppercase tracking-widest hover:bg-yellow-500/20 transition-colors">
                Add Card
              </button>
              <button onClick={() => openGoalForm()} className="flex items-center justify-center gap-3 bg-white text-black py-4 rounded-xl font-black uppercase tracking-widest hover:bg-zinc-200 transition-colors">
                <Trophy size={18} /> Add Goal
              </button>
             <button 
                disabled={loading} 
                onClick={() => {
                  let hp = undefined;
                  let ap = undefined;
                  if (selectedMatch.home_score === selectedMatch.away_score) {
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
             <h4 className="font-black uppercase tracking-widest text-sm text-zinc-400 mb-2">Match events ({events.length})</h4>
             {eventsState.status === 'loading' && events.length === 0 && <p className="text-xs text-zinc-500">Loading events...</p>}
             {eventsState.status === 'error' && <p role="alert" className="text-sm text-red-300">Events could not be loaded ({eventsState.error}). <button type="button" onClick={fetchMatchEvents} className="underline">Try again</button></p>}
             <div className="space-y-3">
               {events.length > 0 ? events.map(ev => (
                 <div key={ev.id} className="flex justify-between items-center bg-white/5 p-4 rounded-xl border border-white/10" data-testid="match-event">
                   <div>
                     <div className="text-sm font-bold text-white flex items-center gap-2">
                       <span className="text-zinc-500 w-8">{ev.minute ?? '?'}'</span>
                       {eventLabel(ev)}
                       {ev.kind === 'own_goal' && <span className="text-[10px] bg-red-500/20 text-red-500 px-2 py-0.5 rounded-sm uppercase tracking-widest">Own Goal</span>}
                       {(ev.kind === 'yellow' || ev.kind === 'red') && <span className={`text-[10px] px-2 py-0.5 rounded-sm uppercase tracking-widest ${ev.kind === 'red' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-400/20 text-yellow-300'}`}>{ev.kind} card</span>}
                     </div>
                     {ev.assist_player_id && <div className="text-[11px] text-zinc-500 mt-1 ml-10">Assist: {getPlayerName(ev.assist_player_id)}</div>}
                   </div>
                   <div className="flex items-center gap-3 ml-4">
                     {busyId === ev.id ? <span className="text-xs text-zinc-500">Saving...</span> : <>
                       {(ev.kind === 'goal' || ev.kind === 'own_goal') && <button type="button" onClick={() => openGoalForm(ev)} className="text-xs font-black uppercase tracking-widest text-zinc-400 hover:text-white">{ev.player_id ? 'Edit' : 'Attribute'}</button>}
                       <button type="button" onClick={() => voidEvent(ev)} className="text-zinc-600 hover:text-red-500 transition-colors" title="Void" aria-label="Void event"><Trash2 size={16} /></button>
                     </>}
                   </div>
                 </div>
               )) : eventsState.status === 'ready' && (
                 <div className="text-center py-6 text-zinc-600 text-xs font-bold uppercase tracking-widest border border-dashed border-white/10 rounded-xl">
                   No events recorded yet.
                 </div>
               )}
             </div>
          </div>

        </div>
      )}
    </div>
  );
}
