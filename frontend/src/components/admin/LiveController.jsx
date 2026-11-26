import React, { useState, useEffect } from 'react';
import { useApi } from '../../hooks/useApi';
import { API_BASE_URL } from '../../lib/api';
import { X, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { DivisionSwitch } from './DivisionSwitch';
import { useAuth } from '../../context/AuthContext';
import { Button, Card, ConfirmDialog, EmptyState, Field, Notice, Pill, Scoreline, Table, useConfirm } from '../ui';
import { formatKickoff } from './adminFormat';
import { cn } from '../../utils/cn';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export default function LiveController() {
  const { hasRole } = useAuth();
  const confirm = useConfirm();
  const [division, setDivision] = useState('super-league');
  const { data: resp, refetch } = useApi(`/admin/matches?status=live,scheduled&division=${division}`);
  const { data: doneResp, refetch: refetchDone } = useApi(`/admin/matches?status=completed&division=${division}`);
  const { data: playersResp } = useApi(`/players?division=${division}`); // the selected division's current season roster 
  
  const matches = resp?.data || [];
  // Finished matches kicked off in the last 7 days, latest first. Older results stay in Fixtures.
  const finishedAll = doneResp?.data || [];
  const weekAgo = Date.now() - WEEK_MS;
  const finished = finishedAll
    .filter((m) => m.date && new Date(m.date).getTime() >= weekAgo)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const [reopenTarget, setReopenTarget] = useState(null);
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

  // Half time keeps the minutes played (as Pause does) so the second half resumes from them.
  const saveHalfTime = () => {
    const startTime = selectedMatch.timer_start_time ? new Date(selectedMatch.timer_start_time).getTime() : null;
    const newCalib = timerRunning && startTime ? Math.floor((Date.now() - startTime) / 60000) + (selectedMatch.timer_calibration || 0) : calibration;
    saveClock({ minute: 'HT', timer_start_time: null, timer_calibration: newCalib });
  };

  // 4. Saves the clock. The screen changes only when the server has stored the change; a refusal is shown inline.
  const [clockBusy, setClockBusy] = useState(false);
  const saveClock = async (fields) => {
    setClockBusy(true);
    setNotice({ type: '', text: '' });
    try {
      const r = await callLive({ action: 'update_time', ...fields });
      if (!r.ok) { setNotice({ type: 'error', text: r.message || 'The clock was not saved.' }); return false; }
      setSelectedMatch((prev) => ({ ...prev, ...fields }));
      if (fields.minute !== undefined) setDisplayTime(fields.minute);
      if (fields.timer_start_time !== undefined) setTimerRunning(Boolean(fields.timer_start_time));
      if (fields.timer_calibration !== undefined) setCalibration(fields.timer_calibration);
      return true;
    } catch (err) {
      setNotice({ type: 'error', text: 'The clock was not saved. Check your connection and try again.' });
      return false;
    } finally { setClockBusy(false); }
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
        setNotice({ type: 'success', text: r.message });
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
      await fetchMatchEvents();
    } finally { setBusyId(''); }
  };

  // Status actions (final whistle) report success so the caller can follow the server.
  const handleAction = async (action, extraData = {}) => {
    setLoading(true);
    try {
      const r = await callLive({ action, ...extraData });
      if (r.ok) { setNotice({ type: 'success', text: r.message }); refetch(); refetchDone(); return true; }
      setNotice({ type: 'error', text: r.message || 'The action failed.' });
      return false;
    } catch (err) { setNotice({ type: 'error', text: 'Action failed. Check your connection.' }); return false; }
    finally { setLoading(false); }
  };

  // The season's format decides whether a tie goes to penalties: knockout seasons always, combined seasons when asked.
  const [seasonFormat, setSeasonFormat] = useState('league');
  useEffect(() => {
    if (!selectedMatch?.season_id) return undefined;
    let current = true;
    supabase.from('seasons').select('format').eq('id', selectedMatch.season_id).maybeSingle()
      .then(({ data }) => { if (current && data) setSeasonFormat(data.format); });
    return () => { current = false; };
  }, [selectedMatch?.season_id]);
  const [whistle, setWhistle] = useState(null); // open final-whistle form: { home, away, koTie }
  const tied = selectedMatch?.home_score === selectedMatch?.away_score;
  const finishedMatch = selectedMatch?.status === 'completed';
  const liveNow = selectedMatch?.status === 'live';
  const penaltiesAsked = tied && (seasonFormat === 'knockout' || (seasonFormat === 'league_knockout' && whistle?.koTie));

  const endMatch = async () => {
    let penalties = {};
    if (penaltiesAsked) {
      const home = whistle.home.trim();
      const away = whistle.away.trim();
      if (!home || !away) throw new Error('Enter both penalty scores.');
      if (!/^\d+$/.test(home) || !/^\d+$/.test(away)) throw new Error('Penalty scores are whole numbers.');
      penalties = { home_penalties: Number(home), away_penalties: Number(away) };
    }
    const ok = await handleAction('close_match', penalties);
    if (!ok) throw new Error('The match was not ended. The scores are unchanged.');
    setTimerRunning(false);
    setSelectedMatch((prev) => ({ ...prev, timer_start_time: null }));
  };

  // Reopening sends the match back to live at its last recorded minute. Its scores and events are kept.
  const reopenMatch = async () => {
    const { data } = await supabase.from('match_events').select('minute').eq('match_id', selectedMatch.id).is('voided_at', null);
    const last = Math.max(0, ...(data || []).map((e) => Number(e.minute) || 0));
    const r = await callLive({ action: 'update_time', minute: `${last}'` });
    if (!r.ok) throw new Error(r.message || 'The match was not reopened.');
    setNotice({ type: 'success', text: 'Match reopened. It is live again.' });
    refetch();
    refetchDone();
  };

  const askHalfTime = async () => {
    const ok = await confirm({ title: 'Start half time?', description: 'The clock stops at this minute. The second half starts from it.', confirmLabel: 'Half time' });
    if (ok) saveHalfTime();
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

  // Removing an event is voiding it: the event stays with who and why. The reason is required, in the dialog.
  const [voidTarget, setVoidTarget] = useState(null);
  const [voidReason, setVoidReason] = useState('');
  const voidEvent = (event) => { setVoidReason(''); setVoidTarget(event); };
  const confirmVoid = async () => {
    const reason = voidReason.trim();
    if (!reason) throw new Error('Give a reason to remove this event.');
    const r = await runEvent({ action: 'void_event', event_id: voidTarget.id, version: voidTarget.version, reason }, voidTarget.id);
    if (!r?.ok) throw new Error(r?.message || 'The event was not removed.');
  };

  const scoreStep = (side, delta) => runEvent({ action: 'score_step', side, delta, id: crypto.randomUUID() }, `${side}${delta}`);
  // One tap: a goal for the team at the clock minute. The scorer is attributed afterwards (Attribute on the event).
  const clockMinute = timerRunning ? (liveMinute || selectedMatch?.timer_calibration || 0) : parseInt(displayTime, 10);
  const quickGoal = (teamId) => runEvent({ action: 'add_event', event: { id: crypto.randomUUID(), kind: 'goal', team_id: teamId, minute: Number.isNaN(clockMinute) ? null : String(clockMinute) } }, `goal-${teamId}`);

  const unattributedCount = events.filter((e) => e.kind === 'goal' && !e.player_id).length;
  const eventLabel = (e) => (e.player_id ? getPlayerName(e.player_id) : e.kind === 'goal' || e.kind === 'own_goal' ? 'Unknown scorer' : 'Unknown player');

  const teamPlayers = allPlayers.filter(p => (p.team_id || p.teams?.id) === goalForm.team_id);

  const handleDivisionSwitch = (newDiv) => {
    setDivision(newDiv);
    setSelectedMatch(null);
    setShowGoalForm(false);
  };

  const getPlayerName = (id) => {
    const player = allPlayers.find(p => p.id === id);
    return player ? `${player.first_name} ${player.last_name}` : 'Unknown Player';
  };

  const scoreboardTeam = (side) => {
    const isHome = side === 'home';
    const name = isHome ? selectedMatch.home_team_name : selectedMatch.away_team_name;
    const score = isHome ? selectedMatch.home_score : selectedMatch.away_score;
    const teamId = isHome ? selectedMatch.home_team_id : selectedMatch.away_team_id;
    return (
      <div className="min-w-0 text-center">
        <div className="truncate text-base font-black uppercase tracking-tight">{name}</div>
        <div className="font-display text-8xl font-black leading-none tabular-nums sm:text-9xl" aria-label={`${isHome ? 'Home' : 'Away'} score`}>{score}</div>
        {!finishedMatch && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <Button size="lg" disabled={busyId !== ''} onClick={() => quickGoal(teamId)} aria-label={`Goal for ${name}`} className="w-full">Goal</Button>
            <Button size="sm" variant="quiet" disabled={busyId !== ''} onClick={() => scoreStep(side, -1)} aria-label={`Minus one ${side}`}>Undo</Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <div className="space-y-8">
        <DivisionSwitch value={division} onChange={handleDivisionSwitch} />

        <section aria-labelledby="live-heading" className="space-y-3">
          <h2 id="live-heading" className="font-display text-2xl font-black uppercase tracking-tight text-ink">Live and scheduled</h2>
          {matches.length > 0 ? (
            <ul className="space-y-2">
              {matches.map((m) => {
                const current = selectedMatch?.id === m.id;
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      aria-pressed={current}
                      onClick={() => { setSelectedMatch(m); setShowGoalForm(false); }}
                      className={`min-h-11 w-full rounded-card border bg-surf p-3 text-left transition-colors duration-200 ease-out ${current ? 'border-acc' : 'border-line hover:border-mut'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-ink">{m.home_team_name} vs {m.away_team_name}</span>
                        <Pill tone={m.status === 'live' ? 'live' : 'neutral'}>{m.status}</Pill>
                      </div>
                      <p className="mt-1 text-sm text-mut">{[formatKickoff(m.date), m.venue].filter(Boolean).join(' · ') || 'No kickoff time'}</p>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title={hasRole('dictator') ? 'No live or scheduled matches' : 'No matches assigned to you'}>
              {hasRole('dictator') ? 'Schedule matches in Fixtures, then they appear here.' : 'Ask a dictator to assign you to a match or season.'}
            </EmptyState>
          )}
        </section>

        <section aria-labelledby="finished-heading" className="space-y-3">
          <h2 id="finished-heading" className="font-display text-2xl font-black uppercase tracking-tight text-ink">Finished matches</h2>
          <p className="text-sm text-mut">Kicked off in the last 7 days.</p>
          {finished.length > 0 ? (
            <ul className="space-y-2">
              {finished.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-line bg-surf p-3">
                  <span className="flex min-w-0 items-center gap-3">
                    <Scoreline home={m.home_score} away={m.away_score} size="sm" />
                    <span className="truncate text-sm text-ink">{m.home_team_name} vs {m.away_team_name}</span>
                  </span>
                  <span className="flex gap-1">
                    <Button size="sm" variant="quiet" aria-label={`Correct ${m.home_team_name} vs ${m.away_team_name}`} onClick={() => { setSelectedMatch(m); setShowGoalForm(false); }}>Correct</Button>
                    <Button size="sm" variant="quiet" aria-label={`Reopen ${m.home_team_name} vs ${m.away_team_name}`} onClick={() => { setSelectedMatch(m); setReopenTarget(m); }}>Reopen</Button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-mut">No matches finished in the last 7 days.</p>
          )}
        </section>
      </div>

      <div className="min-w-0">
        {!selectedMatch ? (
          <EmptyState title="Pick a match">Choose a live or scheduled match to start the clock and record events.</EmptyState>
        ) : (
          <div className="space-y-8">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-2xl font-black uppercase tracking-tight text-ink">{selectedMatch.home_team_name} vs {selectedMatch.away_team_name}</h2>
                <p className="text-sm text-mut">{[selectedMatch.division_name, selectedMatch.season_name, formatKickoff(selectedMatch.date), selectedMatch.venue].filter(Boolean).join(' · ')}</p>
              </div>
              <Pill tone={finishedMatch ? 'neutral' : selectedMatch.status === 'live' ? 'live' : 'acc'}>{finishedMatch ? 'Finished' : selectedMatch.status}</Pill>
            </div>

            <div className={cn('pitch grid grid-cols-[1fr_auto_1fr] items-start gap-3 rounded-card border border-line p-5 text-ink', liveNow && 'beam')}>
              {scoreboardTeam('home')}
              <div className="flex flex-col items-center gap-3 pt-4 font-display text-2xl font-black uppercase tracking-tight">
                {liveNow && <span aria-hidden="true" className="size-2.5 rounded-full bg-live motion-safe:animate-ping" />}
                {finishedMatch ? 'FT' : 'v'}
              </div>
              {scoreboardTeam('away')}
            </div>

            {finishedMatch ? (
              <Card className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-mut">Finished. Correct the events below, or reopen the match to keep scoring.</p>
                <Button variant="secondary" onClick={() => setReopenTarget(selectedMatch)}>Reopen match</Button>
              </Card>
            ) : (
              <Card className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-display text-xl font-black uppercase tracking-tight text-ink">Match clock</h3>
                  <span className={`font-display text-4xl font-bold tabular-nums text-ink ${timerRunning ? 'motion-safe:animate-pulse text-live' : ''}`}>
                    {displayTime || `${liveMinute}'`}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_auto_minmax(0,1fr)] sm:items-end">
                  {!timerRunning ? (
                    <Button disabled={clockBusy} onClick={() => saveClock({ minute: `${calibration}'`, timer_start_time: new Date().toISOString(), timer_calibration: calibration })}>Start</Button>
                  ) : (
                    <Button variant="secondary" disabled={clockBusy} onClick={() => {
                      // Pause stores the minutes played and stops the clock.
                      const startTime = new Date(selectedMatch.timer_start_time).getTime();
                      const newCalib = Math.floor((Date.now() - startTime) / 60000) + (selectedMatch.timer_calibration || 0);
                      saveClock({ minute: `${newCalib}'`, timer_start_time: null, timer_calibration: newCalib });
                    }}>Pause</Button>
                  )}
                  <Button variant={displayTime === 'HT' ? 'primary' : 'secondary'} disabled={clockBusy} onClick={askHalfTime}>Half time</Button>
                  <div className="flex items-end gap-2">
                    <Field type="number" label="Clock minute" value={calibration} onChange={e => setCalibration(parseInt(e.target.value) || 0)} className="min-w-0 flex-1" />
                    <Button variant="secondary" disabled={clockBusy} onClick={() => saveClock(timerRunning ? { timer_calibration: calibration } : { minute: `${calibration}'`, timer_calibration: calibration })}>Set</Button>
                  </div>
                </div>
              </Card>
            )}

            <ConfirmDialog
              open={Boolean(voidTarget)}
              onOpenChange={(open) => { if (!open) setVoidTarget(null); }}
              title="Remove this event?"
              description={voidTarget ? `${voidTarget.minute ?? '?'}' ${eventLabel(voidTarget)}. The event is kept in the history with your reason.` : ''}
              confirmLabel="Remove event"
              tone="danger"
              onConfirm={confirmVoid}
            >
              <Field label="Reason" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="For example, wrong player" />
            </ConfirmDialog>

            {notice.text && <Notice tone={notice.type === 'error' ? 'error' : 'success'} role={notice.type === 'error' ? 'alert' : 'status'}>{notice.text}</Notice>}
            {unattributedCount > 0 && <Notice tone="warning" role="note">{unattributedCount} goal{unattributedCount === 1 ? '' : 's'} unattributed: choose Attribute on the goal to add its scorer. They count toward the score and toward no player.</Notice>}

            {candidates && (
              <Card as="div" role="group" aria-label="Choose the goal to correct" className="space-y-3">
                <p className="text-sm font-semibold text-ink">Which goal should be removed?</p>
                {candidates.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-ctl border border-line p-3 text-sm">
                    <span>{c.minute ?? '?'}' · {eventLabel(c)}</span>
                    <Button variant="danger" size="sm" onClick={() => voidEvent(c)}>Void this goal</Button>
                  </div>
                ))}
                <Button variant="quiet" size="sm" onClick={() => setCandidates(null)}>Cancel</Button>
              </Card>
            )}

            {showCardForm && (
              <Card as="form" onSubmit={submitCard} className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-display text-xl font-black uppercase tracking-tight text-ink">Add card</h3>
                  <Button variant="quiet" size="sm" aria-label="Close card form" onClick={() => setShowCardForm(false)} className="px-2"><X size={18} aria-hidden="true" /></Button>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field as="select" label="Card colour" value={cardForm.kind} onChange={e => setCardForm({ ...cardForm, kind: e.target.value })}>
                    <option value="yellow">Yellow card</option>
                    <option value="red">Red card</option>
                  </Field>
                  <Field label="Card minute" placeholder="Minute" value={cardForm.minute} onChange={e => setCardForm({ ...cardForm, minute: e.target.value })} />
                  <Field as="select" label="Card team" required value={cardForm.team_id} onChange={e => setCardForm({ ...cardForm, team_id: e.target.value, player_id: '' })}>
                    <option value="">Select team...</option>
                    <option value={selectedMatch.home_team_id}>{selectedMatch.home_team_name} (Home)</option>
                    <option value={selectedMatch.away_team_id}>{selectedMatch.away_team_name} (Away)</option>
                  </Field>
                  <Field as="select" label="Carded player" required disabled={!cardForm.team_id} value={cardForm.player_id} onChange={e => setCardForm({ ...cardForm, player_id: e.target.value })}>
                    <option value="">Select player...</option>
                    {allPlayers.filter(p => (p.team_id || p.teams?.id) === cardForm.team_id).map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
                  </Field>
                </div>
                <Button type="submit" disabled={busyId !== ''} className="w-full sm:w-auto">{busyId !== '' ? 'Saving...' : 'Confirm card'}</Button>
              </Card>
            )}

            {showGoalForm ? (
              <Card as="form" onSubmit={submitGoal} className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-display text-xl font-black uppercase tracking-tight text-ink">{goalForm.editId ? 'Correct goal' : 'Register goal'}</h3>
                  <Button variant="quiet" size="sm" aria-label="Close goal form" onClick={() => setShowGoalForm(false)} className="px-2"><X size={18} aria-hidden="true" /></Button>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field as="select" label={goalForm.is_own_goal ? 'Offending team (own goal)' : 'Scoring team'} required value={goalForm.team_id} onChange={e => setGoalForm({...goalForm, team_id: e.target.value, player_id: '', assist_id: ''})}>
                    <option value="" disabled>Select team...</option>
                    <option value={selectedMatch.home_team_id}>{selectedMatch.home_team_name} (Home)</option>
                    <option value={selectedMatch.away_team_id}>{selectedMatch.away_team_name} (Away)</option>
                  </Field>
                  <Field label="Minute" placeholder="e.g. 45" value={goalForm.minute} onChange={e => setGoalForm({...goalForm, minute: e.target.value})} />
                  <Field as="select" label="Goal type" value={goalForm.is_own_goal ? 'own_goal' : 'regular'} onChange={e => { const isOwn = e.target.value === 'own_goal'; setGoalForm(prev => ({ ...prev, is_own_goal: isOwn, assist_id: isOwn ? '' : prev.assist_id })); }}>
                    <option value="regular">Regular goal</option>
                    <option value="own_goal">Own goal</option>
                  </Field>
                  <Field as="select" label={goalForm.is_own_goal ? 'Player who scored own goal' : 'Goalscorer'} disabled={!goalForm.team_id} value={goalForm.player_id} onChange={e => setGoalForm({...goalForm, player_id: e.target.value})}>
                    <option value="">Scorer not known yet</option>
                    {teamPlayers.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
                  </Field>
                  <Field as="select" label="Assist (optional)" disabled={!goalForm.team_id || goalForm.is_own_goal} value={goalForm.assist_id} onChange={e => setGoalForm({...goalForm, assist_id: e.target.value})}>
                    <option value="">{goalForm.is_own_goal ? 'No assists on own goals' : 'No assist (solo)'}</option>
                    {teamPlayers.filter(p => p.id !== goalForm.player_id).map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
                  </Field>
                </div>
                <Button type="submit" disabled={busyId !== ''} className="w-full sm:w-auto">
                  {busyId !== '' ? 'Saving...' : goalForm.editId ? 'Save correction' : 'Confirm goal'}
                </Button>
              </Card>
            ) : !finishedMatch && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Button variant="secondary" size="lg" onClick={() => { setCardForm({ id: crypto.randomUUID(), kind: 'yellow', team_id: '', player_id: '', minute: '' }); setShowGoalForm(false); setShowCardForm(true); }}>Add card</Button>
                <Button size="lg" onClick={() => openGoalForm()}>Add goal</Button>
                <Button variant="secondary" size="lg" disabled={loading} onClick={() => setWhistle({ home: '', away: '', koTie: false })}>Final whistle</Button>
              </div>
            )}

            <ConfirmDialog
              open={reopenTarget !== null}
              onOpenChange={(open) => { if (!open) setReopenTarget(null); }}
              title="Reopen this match?"
              description={`${selectedMatch.home_team_name} vs ${selectedMatch.away_team_name} goes back to live at its last recorded minute. Scores and events are kept.`}
              confirmLabel="Reopen match"
              onConfirm={reopenMatch}
            />
            <ConfirmDialog
              open={whistle !== null}
              onOpenChange={(open) => { if (!open) setWhistle(null); }}
              title="End this match?"
              description={`Final score ${selectedMatch.home_score} to ${selectedMatch.away_score}. The scores are locked for grading.`}
              confirmLabel="End match"
              tone="danger"
              onConfirm={endMatch}
            >
              {tied && seasonFormat === 'league_knockout' && (
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-ink">
                  <input type="checkbox" className="size-5 accent-acc" checked={whistle?.koTie ?? false} onChange={(e) => setWhistle((w) => ({ ...w, koTie: e.target.checked }))} />
                  This is a knockout tie
                </label>
              )}
              {penaltiesAsked && (
                <div className="grid grid-cols-2 gap-3">
                  <Field type="number" min="0" label="Home penalties" value={whistle?.home ?? ''} onChange={(e) => setWhistle((w) => ({ ...w, home: e.target.value }))} />
                  <Field type="number" min="0" label="Away penalties" value={whistle?.away ?? ''} onChange={(e) => setWhistle((w) => ({ ...w, away: e.target.value }))} />
                </div>
              )}
            </ConfirmDialog>

            <section aria-labelledby="events-heading" className="space-y-3">
              <h3 id="events-heading" className="font-display text-xl font-black uppercase tracking-tight text-ink">Match events ({events.length})</h3>
              {eventsState.status === 'loading' && events.length === 0 && <p className="text-sm text-mut">Loading events...</p>}
              {eventsState.status === 'error' && <Notice tone="error" role="alert">Events could not be loaded ({eventsState.error}). <Button variant="quiet" size="sm" onClick={fetchMatchEvents}>Try again</Button></Notice>}
              {events.length > 0 ? (
                <Table caption="Match events">
                  <thead>
                    <tr><th scope="col">Minute</th><th scope="col">Event</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
                  </thead>
                  <tbody>
                    {events.map(ev => (
                      <tr key={ev.id} data-testid="match-event">
                        <td className="font-display text-lg tabular-nums text-mut">{ev.minute ?? '?'}'</td>
                        <td>
                          <div className="flex flex-wrap items-center gap-2 font-semibold">
                            {eventLabel(ev)}
                            {ev.kind === 'own_goal' && <Pill tone="live">Own goal</Pill>}
                            {(ev.kind === 'yellow' || ev.kind === 'red') && <Pill tone={ev.kind === 'red' ? 'live' : 'acc'}>{ev.kind} card</Pill>}
                          </div>
                          {ev.assist_player_id && <div className="text-sm text-mut">Assist: {getPlayerName(ev.assist_player_id)}</div>}
                        </td>
                        <td>
                          <div className="flex justify-end gap-1">
                            {busyId === ev.id ? <span className="px-2 text-sm text-mut">Saving...</span> : <>
                              {(ev.kind === 'goal' || ev.kind === 'own_goal') && <Button variant="quiet" size="sm" onClick={() => openGoalForm(ev)}>{ev.player_id ? 'Edit' : 'Attribute'}</Button>}
                              <Button variant="quiet" size="sm" onClick={() => voidEvent(ev)} aria-label="Void event" className="px-2 text-mut hover:text-live"><Trash2 size={16} aria-hidden="true" /></Button>
                            </>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : eventsState.status === 'ready' && (
                <EmptyState title="No events recorded yet">Goals and cards you add appear here, and can be corrected.</EmptyState>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
