import React, { useState, useEffect } from 'react';
import { useApi } from '../../hooks/useApi';
import { API_BASE_URL } from '../../lib/api';
import { AlarmClockOff, ChevronLeft, Flag, Minus, Pause, Play, Plus, Timer } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { DivisionSwitch } from './DivisionSwitch';
import { useAuth } from '../../context/AuthContext';
import { Button, Card, Checkbox, ConfirmDialog, Crest, Field, Notice, NumberField, toast, useConfirm } from '../ui';
import { formatKickoff } from './adminFormat';
import { cn } from '../../utils/cn';
import { MatchPicker } from './live/MatchPicker';
import { EventSheet } from './live/EventSheet';
import { EventTimeline, KIND_LABEL, KindIcon } from './live/EventTimeline';
import { MAX_MINUTE, RUNAWAY_MINUTE, clockMinute, eventMinute, inFirstHalf, minuteLabel, recordedMinute, totalMinute } from './live/clock';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const emptyForm = { id: null, editId: null, version: null, kind: 'goal', team_id: '', player_id: '', assist_id: '', minute: null };

export default function LiveController() {
  const { hasRole } = useAuth();
  const confirm = useConfirm();
  const [division, setDivision] = useState('super-league');
  const { data: resp, refetch } = useApi(`/admin/matches?status=live,scheduled&division=${division}`);
  const { data: doneResp, refetch: refetchDone } = useApi(`/admin/matches?status=completed&division=${division}`);
  const { data: playersResp } = useApi(`/players?division=${division}`); // the selected division's current season roster
  const { data: teamsResp } = useApi(`/teams?division=${division}`); // crests and colours

  // Live matches first, then fixtures by kick-off.
  const matches = [...(resp?.data || [])].sort((a, b) => (b.status === 'live') - (a.status === 'live'));
  // Finished matches kicked off in the last 7 days, latest first. Older results are found by search.
  const finishedAll = [...(doneResp?.data || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  const weekAgo = Date.now() - WEEK_MS;
  const finished = finishedAll.filter((m) => m.date && new Date(m.date).getTime() >= weekAgo);
  const older = finishedAll.filter((m) => !finished.includes(m));
  const [reopenTarget, setReopenTarget] = useState(null);
  const allPlayers = playersResp?.data || [];
  const teams = new Map((teamsResp?.data || []).map((t) => [t.id, t]));
  const crest = (id) => teams.get(id);

  const [selectedMatch, setSelectedMatch] = useState(null);
  const [loading, setLoading] = useState(false);

  // --- MATCH CLOCK ---
  // The minute is computed from the stored start and calibration; `now` ticks while the clock runs.
  const [now, setNow] = useState(Date.now());
  const [minuteDraft, setMinuteDraft] = useState(null); // a minute typed in Set minute, until it is saved
  const stopped = selectedMatch?.minute === 'HT' || selectedMatch?.minute === 'FT';
  const timerRunning = selectedMatch?.status === 'live' && Boolean(selectedMatch?.timer_start_time) && !stopped;
  const firstHalf = timerRunning && inFirstHalf(selectedMatch);
  const currentMinute = clockMinute(selectedMatch, now) ?? 0;
  const runaway = timerRunning && currentMinute > RUNAWAY_MINUTE;

  // --- MATCH EVENTS (goals, own goals and cards; the score is a cache of them, never typed in) ---
  const [events, setEvents] = useState([]);
  const [eventsState, setEventsState] = useState({ status: 'idle', error: '' });
  const [busyId, setBusyId] = useState('');
  const [candidates, setCandidates] = useState(null); // goals to choose from when -1 has no unattributed goal
  const [sheetOpen, setSheetOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const say = (ok, text) => toast({ title: text, tone: ok ? 'success' : 'error' });

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

  useEffect(() => {
    if (!selectedMatch) return;
    setMinuteDraft(null);
    setNow(Date.now());
    fetchMatchEvents();
  }, [selectedMatch?.id]);

  // The ticker: recompute the minute every second while the clock runs (nothing is written).
  useEffect(() => {
    if (!timerRunning) return undefined;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [timerRunning]);

  // Saves the clock. The screen changes only when the server has stored the change; a refusal is shown as a toast.
  const [clockBusy, setClockBusy] = useState(false);
  const saveClock = async (fields) => {
    setClockBusy(true);
    try {
      const r = await callLive({ action: 'update_time', ...fields });
      if (!r.ok) { say(false, r.message || 'The clock was not saved.'); return false; }
      setSelectedMatch((prev) => ({ ...prev, ...fields }));
      setMinuteDraft(null);
      setNow(Date.now());
      return true;
    } catch (err) {
      say(false, 'The clock was not saved. Check your connection and try again.');
      return false;
    } finally { setClockBusy(false); }
  };

  const playedNow = () => clockMinute(selectedMatch, Date.now()) ?? 0;
  const startClock = () => {
    const from = minuteDraft ?? playedNow();
    saveClock({ minute: `${from}'`, timer_start_time: new Date().toISOString(), timer_calibration: from });
  };
  // Pause and half time store the minutes played and stop the clock; the next start resumes from them.
  const pauseClock = (at = playedNow()) => saveClock({ minute: `${at}'`, timer_start_time: null, timer_calibration: at });
  const saveHalfTime = () => saveClock({ minute: 'HT', timer_start_time: null, timer_calibration: timerRunning ? playedNow() : (clockMinute(selectedMatch) ?? 0) });
  // Set minute: a running clock restarts its stint from the new minute, a stopped one just stores it.
  const setClock = () => {
    const at = minuteDraft ?? currentMinute;
    saveClock(timerRunning
      ? { minute: `${at}'`, timer_start_time: new Date().toISOString(), timer_calibration: at }
      : { minute: `${at}'`, timer_calibration: at });
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
  // explained and the list is refreshed, so the scorer sees what changed.
  const runEvent = async (payload, busy = 'form') => {
    setBusyId(busy);
    try {
      const r = await callLive(payload);
      if (r.ok) {
        say(true, r.message);
        setCandidates(null);
        setSheetOpen(false);
        refetch();
      } else {
        if (r.status === 409 && r.candidates) setCandidates(r.candidates);
        say(false, r.message || 'The change was not saved.');
      }
      await fetchMatchEvents();
      return r;
    } catch (err) {
      say(false, 'The change was not saved. Check your connection and try again.');
      await fetchMatchEvents();
    } finally { setBusyId(''); }
  };

  // Status actions (final whistle) report success so the caller can follow the server.
  const handleAction = async (action, extraData = {}) => {
    setLoading(true);
    try {
      const r = await callLive({ action, ...extraData });
      if (r.ok) { say(true, r.message); refetch(); refetchDone(); return true; }
      say(false, r.message || 'The action failed.');
      return false;
    } catch (err) { say(false, 'Action failed. Check your connection.'); return false; }
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
    setSelectedMatch((prev) => ({ ...prev, timer_start_time: null }));
  };

  // Reopening sends the match back to live at its last recorded minute, with the clock stopped (closing a match
  // leaves its old start time, which would otherwise run the clock from it). Its scores and events are kept.
  const reopenMatch = async () => {
    const { data } = await supabase.from('match_events').select('minute').eq('match_id', selectedMatch.id).is('voided_at', null);
    const last = Math.max(0, ...(data || []).map((e) => Number(e.minute) || 0));
    const fields = { minute: `${last}'`, timer_start_time: null, timer_calibration: last };
    const r = await callLive({ action: 'update_time', ...fields });
    if (!r.ok) throw new Error(r.message || 'The match was not reopened.');
    setSelectedMatch((prev) => ({ ...prev, ...fields }));
    say(true, 'Match reopened. It is live again.');
    refetch();
    refetchDone();
  };

  const askHalfTime = async () => {
    const ok = await confirm({ title: 'Start half time?', description: 'The clock stops at this minute. The second half starts from it.', confirmLabel: 'Half time' });
    if (ok) saveHalfTime();
  };

  const submitEvent = (e) => {
    e.preventDefault();
    const minute = eventMinute(form.minute, firstHalf);
    if (form.kind === 'yellow' || form.kind === 'red') {
      runEvent({ action: 'add_event', event: { id: form.id, kind: form.kind, team_id: form.team_id, player_id: form.player_id, minute } });
      return;
    }
    const base = { kind: form.kind, team_id: form.team_id, player_id: form.player_id || null,
      assist_player_id: form.kind === 'own_goal' ? null : (form.assist_id || null), minute };
    if (form.editId) runEvent({ action: 'edit_event', event_id: form.editId, version: form.version, changes: base }, form.editId);
    else runEvent({ action: 'add_event', event: { id: form.id, ...base } });
  };

  // A new event of a kind, at the clock minute; or a recorded goal to correct.
  const openSheet = (kind) => {
    setForm({ ...emptyForm, id: crypto.randomUUID(), kind, minute: currentMinute });
    setSheetOpen(true);
  };
  const editGoal = (event) => {
    setForm({ ...emptyForm, editId: event.id, version: event.version, kind: event.kind, team_id: event.team_id,
      player_id: event.player_id || '', assist_id: event.assist_player_id || '', minute: totalMinute(event) });
    setSheetOpen(true);
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
  const quickGoal = (teamId) => runEvent({ action: 'add_event', event: { id: crypto.randomUUID(), kind: 'goal', team_id: teamId, minute: eventMinute(playedNow(), firstHalf) } }, `goal-${teamId}`);

  const unattributedCount = events.filter((e) => e.kind === 'goal' && !e.player_id).length;
  const getPlayerName = (id) => {
    const player = allPlayers.find(p => p.id === id);
    return player ? `${player.first_name} ${player.last_name}` : 'Unknown Player';
  };
  const eventLabel = (e) => (e.player_id ? getPlayerName(e.player_id) : e.kind === 'goal' || e.kind === 'own_goal' ? 'Unknown scorer' : 'Unknown player');

  const pickMatch = (m) => { if (m) { setSelectedMatch(m); setSheetOpen(false); setCandidates(null); } };
  const handleDivisionSwitch = (newDiv) => {
    setDivision(newDiv);
    setSelectedMatch(null);
    setSheetOpen(false);
  };

  const status = finishedMatch ? 'Full time'
    : selectedMatch?.minute === 'HT' ? 'Half time'
      : timerRunning ? `Live · ${minuteLabel(currentMinute, firstHalf)}′`
        : liveNow ? `Paused · ${minuteLabel(currentMinute)}′`
          : formatKickoff(selectedMatch?.date) || 'Not started';

  const scoreboardTeam = (side) => {
    const isHome = side === 'home';
    const name = isHome ? selectedMatch.home_team_name : selectedMatch.away_team_name;
    const score = isHome ? selectedMatch.home_score : selectedMatch.away_score;
    const teamId = isHome ? selectedMatch.home_team_id : selectedMatch.away_team_id;
    return (
      <div className="flex min-w-0 flex-col items-center gap-3 text-center">
        <Crest name={name} src={crest(teamId)?.logo_url} color={crest(teamId)?.team_color} size="lg" className="ring-1 ring-white/15" />
        <div className="line-clamp-2 min-h-[2lh] font-display text-sm font-black uppercase leading-tight tracking-tight text-white sm:text-lg">{name}</div>
        <div className="chrome font-display text-7xl font-black leading-none tabular-nums sm:text-8xl" aria-label={`${isHome ? 'Home' : 'Away'} score`}>{score}</div>
        {!finishedMatch && (
          <div className="flex w-full max-w-40 gap-2">
            <Button variant="secondary" disabled={busyId !== ''} onClick={() => scoreStep(side, -1)} aria-label={`Minus one ${side}`} className="size-12 shrink-0 px-0"><Minus size={20} aria-hidden="true" /></Button>
            <Button disabled={busyId !== ''} onClick={() => quickGoal(teamId)} aria-label={`Goal for ${name}`} className="min-h-12 flex-1 px-0"><Plus size={20} aria-hidden="true" /></Button>
          </div>
        )}
      </div>
    );
  };

  const clockButton = 'min-h-14 flex-1 flex-col gap-1 rounded-ctl px-1 text-[11px] tracking-[0.12em]';

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <div className={cn('min-w-0 space-y-6', selectedMatch && 'hidden lg:block')}>
        <DivisionSwitch value={division} onChange={handleDivisionSwitch} />
        <MatchPicker
          matches={matches}
          finished={finished}
          older={older}
          selectedId={selectedMatch?.id}
          crest={crest}
          emptyTitle={hasRole('dictator') ? 'No live or scheduled matches' : 'No matches assigned to you'}
          emptyText={hasRole('dictator') ? 'Schedule matches in Fixtures, then they appear here.' : 'Ask a dictator to assign you to a match or season.'}
          onPick={pickMatch}
          onReopen={(m) => { pickMatch(m); setReopenTarget(m); }}
        />
      </div>

      <div className="min-w-0">
        {!selectedMatch ? (
          <div className="glass hidden min-h-80 flex-col items-center justify-center gap-3 rounded-card p-8 text-center lg:flex">
            <Timer size={28} aria-hidden="true" className="text-mut" />
            <p className="font-display text-2xl font-black uppercase tracking-tight text-ink">Pick a match</p>
            <p className="max-w-xs text-sm text-mut">Choose a live or scheduled match to run the clock and record events.</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-3">
              <Button variant="quiet" size="sm" onClick={() => setSelectedMatch(null)} className="-ml-2 px-2 lg:hidden"><ChevronLeft size={18} aria-hidden="true" />All matches</Button>
              <p className="eyebrow min-w-0 truncate lg:ml-0">{[selectedMatch.division_name, selectedMatch.season_name, selectedMatch.venue].filter(Boolean).join(' · ')}</p>
            </div>

            <div className={cn('pitch rounded-card border border-white/10 px-3 pb-5 pt-4 sm:px-6 sm:pb-7', liveNow && 'beam')}>
              <h2 className="sr-only">{selectedMatch.home_team_name} vs {selectedMatch.away_team_name}</h2>
              <div className="flex justify-center">
                <span className="inline-flex items-center gap-2.5 rounded-pill border border-white/15 bg-black/50 px-4 py-1.5 text-[11px] font-black uppercase tracking-[0.25em] text-white backdrop-blur-md">
                  {timerRunning && (
                    <span aria-hidden="true" className="relative flex size-2.5">
                      <span className="absolute inline-flex size-full rounded-full bg-live opacity-75 motion-safe:animate-ping" />
                      <span className="relative inline-flex size-2.5 rounded-full bg-live" />
                    </span>
                  )}
                  {status}
                </span>
              </div>
              <div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 sm:gap-6">
                {scoreboardTeam('home')}
                <div aria-hidden="true" className="pt-24 font-display text-3xl font-black text-white/40 sm:pt-28">-</div>
                {scoreboardTeam('away')}
              </div>
            </div>

            {runaway && (
              <div role="alert" className="flex flex-col gap-3 rounded-card border border-live/50 bg-live/10 p-4 sm:flex-row sm:items-center">
                <AlarmClockOff size={22} aria-hidden="true" className="shrink-0 text-live" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-ink">The clock was left running ({currentMinute} minutes).</p>
                  <p className="text-sm text-mut">Stop it at 90 or set the right minute below. If the match is over, end it.</p>
                </div>
                <Button variant="danger" disabled={clockBusy} onClick={() => pauseClock(90)}>Stop at 90′</Button>
              </div>
            )}

            {finishedMatch ? (
              <Card className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-mut">Finished. Correct the events below, or reopen the match to keep scoring.</p>
                <Button variant="secondary" onClick={() => setReopenTarget(selectedMatch)}>Reopen match</Button>
              </Card>
            ) : (
              <Card className="space-y-4">
                <div className="flex items-end justify-between gap-3">
                  <h3 className="eyebrow">Match clock</h3>
                  <span className={cn('chrome font-display text-5xl font-black leading-none tabular-nums', runaway && 'text-live')}>
                    {stopped ? selectedMatch.minute : `${minuteLabel(currentMinute, firstHalf)}′`}
                  </span>
                </div>
                <div role="group" aria-label="Clock" className="well flex gap-1 rounded-ctl p-1">
                  {!timerRunning ? (
                    <Button disabled={clockBusy} onClick={startClock} className={clockButton}><Play size={18} aria-hidden="true" />Start</Button>
                  ) : (
                    <Button variant="quiet" disabled={clockBusy} onClick={() => pauseClock()} className={clockButton}><Pause size={18} aria-hidden="true" />Pause</Button>
                  )}
                  <Button variant={selectedMatch.minute === 'HT' ? 'primary' : 'quiet'} disabled={clockBusy} onClick={askHalfTime} className={clockButton}><Timer size={18} aria-hidden="true" />Half time</Button>
                  <Button variant="quiet" disabled={loading} onClick={() => setWhistle({ home: '', away: '', koTie: false })} className={clockButton}><Flag size={18} aria-hidden="true" />Full time</Button>
                </div>
                <Field label="Set minute">
                  {(p) => (
                    <div className="flex items-center gap-2">
                      <NumberField aria-labelledby={p['aria-labelledby']} min={0} max={MAX_MINUTE} value={minuteDraft ?? currentMinute} onChange={setMinuteDraft} className="flex-1" />
                      <Button variant="secondary" disabled={clockBusy || minuteDraft === null} onClick={setClock}>Set</Button>
                    </div>
                  )}
                </Field>
              </Card>
            )}

            <div className="grid grid-cols-4 gap-2">
              {['goal', 'own_goal', 'yellow', 'red'].map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => openSheet(kind)}
                  className="glass lift flex min-h-20 flex-col items-center justify-center gap-2 rounded-card px-1 text-ink outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
                >
                  <KindIcon kind={kind} size={24} />
                  <span className="text-[11px] font-black uppercase tracking-[0.12em]">{kind === 'goal' ? 'Add goal' : KIND_LABEL[kind].replace(' card', '')}</span>
                </button>
              ))}
            </div>

            {unattributedCount > 0 && <Notice tone="warning" role="note">{unattributedCount} goal{unattributedCount === 1 ? '' : 's'} unattributed: choose Attribute on the goal to add its scorer. They count toward the score and toward no player.</Notice>}

            {candidates && (
              <Card as="div" role="group" aria-label="Choose the goal to correct" className="space-y-3">
                <p className="text-sm font-semibold text-ink">Which goal should be removed?</p>
                {candidates.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-ctl border border-line p-3 text-sm">
                    <span>{recordedMinute(c)}′ · {eventLabel(c)}</span>
                    <Button variant="danger" size="sm" onClick={() => voidEvent(c)}>Void this goal</Button>
                  </div>
                ))}
                <Button variant="quiet" size="sm" onClick={() => setCandidates(null)}>Cancel</Button>
              </Card>
            )}

            <EventTimeline
              events={events}
              state={eventsState}
              match={selectedMatch}
              playerName={getPlayerName}
              busyId={busyId}
              onEdit={editGoal}
              onRemove={voidEvent}
              onRetry={fetchMatchEvents}
            />

            <EventSheet
              open={sheetOpen}
              onClose={() => setSheetOpen(false)}
              form={form}
              setForm={setForm}
              match={selectedMatch}
              crest={crest}
              players={allPlayers}
              busy={busyId !== ''}
              onSubmit={submitEvent}
            />

            <ConfirmDialog
              open={Boolean(voidTarget)}
              onOpenChange={(open) => { if (!open) setVoidTarget(null); }}
              title="Remove this event?"
              description={voidTarget ? `${recordedMinute(voidTarget)}′ ${eventLabel(voidTarget)}. The event is kept in the history with your reason.` : ''}
              confirmLabel="Remove event"
              tone="danger"
              onConfirm={confirmVoid}
            >
              <Field label="Reason" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="For example, wrong player" />
            </ConfirmDialog>
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
                <Checkbox checked={whistle?.koTie ?? false} onChange={(koTie) => setWhistle((w) => ({ ...w, koTie }))} label="This is a knockout tie" />
              )}
              {penaltiesAsked && (
                <div className="grid grid-cols-2 gap-3">
                  <Field type="number" min="0" label="Home penalties" value={whistle?.home ?? ''} onChange={(e) => setWhistle((w) => ({ ...w, home: e.target.value }))} />
                  <Field type="number" min="0" label="Away penalties" value={whistle?.away ?? ''} onChange={(e) => setWhistle((w) => ({ ...w, away: e.target.value }))} />
                </div>
              )}
            </ConfirmDialog>
          </div>
        )}
      </div>
    </div>
  );
}
