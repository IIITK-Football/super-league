import { useEffect, useRef, useState } from 'react';
import { Activity, Loader2, Save, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useLatestSearch } from '../../hooks/useLatestSearch';

// Scorers. A scorer holds the scorer grant and an assignment scoped to one season (every match of it) or one match, with
// an optional expiry. The dictator assigns and revokes here through the dictator-only database functions
// (assign_scorer, revoke_scorer), which add or remove the grant with the last assignment. Assignments are listed with
// the person's directory label (verified email, name as context; never a profile email or raw id). Assigning someone
// who captains a team in that season or match shows a warning: a captain scores their own team's match only with an
// explicit assignment, and the warning makes that deliberate.
const inputClass = 'w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-[#d9ff4a]/60';
const labelClass = 'text-[10px] font-black uppercase tracking-widest text-zinc-500';
const when = (iso) => (iso ? new Date(iso).toLocaleString() : 'No expiry');
const named = (m) => `${m.home?.name ?? 'Home'} vs ${m.away?.name ?? 'Away'}`;

export default function ManageScorers() {
  const [state, setState] = useState({ status: 'loading', rows: [], labels: {}, error: '' });
  const [divisions, setDivisions] = useState([]);
  const [divisionId, setDivisionId] = useState('');
  const [seasons, setSeasons] = useState([]);
  const [seasonId, setSeasonId] = useState('');
  const [matches, setMatches] = useState([]);
  const [matchId, setMatchId] = useState('');
  const [expires, setExpires] = useState('');
  const [picked, setPicked] = useState({ id: '', label: '' });
  const [query, setQuery] = useState('');
  const [captainWarning, setCaptainWarning] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const latest = useRef({ list: 0, seasons: 0, matches: 0, warning: 0 });
  const search = useLatestSearch((text) => supabase.rpc('account_directory', { p_query: text, p_limit: 20 }), query, { minLength: 2 });

  const load = async () => {
    const n = ++latest.current.list;
    setState((s) => ({ ...s, status: 'loading', error: '' }));
    const { data, error: err } = await supabase
      .from('scorer_assignments')
      .select('id, user_id, season_id, match_id, expires_at, season:seasons(name, division:divisions(name)), match:matches(id, date, home:teams!home_team_id(name), away:teams!away_team_id(name), season:seasons(name))')
      .order('assigned_at', { ascending: false });
    if (n !== latest.current.list) return;
    if (err) { setState({ status: 'error', rows: [], labels: {}, error: err.message }); return; }
    const ids = [...new Set((data || []).map((r) => r.user_id))];
    const { data: people } = ids.length ? await supabase.rpc('account_directory', { p_ids: ids, p_limit: 200 }) : { data: [] };
    if (n !== latest.current.list) return;
    setState({ status: 'ready', rows: data || [], labels: Object.fromEntries((people || []).map((p) => [p.user_id, p.label])), error: '' });
  };

  useEffect(() => {
    load();
    (async () => {
      const { data, error: err } = await supabase.from('divisions').select('id, name').order('sort_order', { ascending: true });
      if (err) setError(err.message);
      setDivisions(data || []);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseDivision = async (id) => {
    const n = ++latest.current.seasons;
    latest.current.matches += 1;
    setDivisionId(id); setSeasons([]); setSeasonId(''); setMatches([]); setMatchId(''); setError('');
    if (!id) return;
    const { data, error: err } = await supabase.from('seasons').select('id, name, is_current').eq('division_id', id).order('sort_order', { ascending: true });
    if (n !== latest.current.seasons) return;
    if (err) setError(err.message);
    setSeasons(data || []);
  };
  const chooseSeason = async (id) => {
    const n = ++latest.current.matches;
    setSeasonId(id); setMatches([]); setMatchId('');
    if (!id) return;
    const { data, error: err } = await supabase.from('matches').select('id, date, status, home:teams!home_team_id(id, name), away:teams!away_team_id(id, name)').eq('season_id', id).order('date', { ascending: true });
    if (n !== latest.current.matches) return;
    if (err) setError(err.message);
    setMatches(data || []);
  };

  // Does the chosen person captain a team in this season (or one of the chosen match's teams)? Shown, never blocking.
  useEffect(() => {
    const n = ++latest.current.warning;
    setCaptainWarning('');
    if (!picked.id || !seasonId) return;
    (async () => {
      const { data } = await supabase.from('captain_assignments').select('team_entry:team_entries!inner(team_id, season_id, team:teams(name))').eq('user_id', picked.id);
      if (n !== latest.current.warning) return;
      const match = matches.find((m) => m.id === matchId);
      const hits = (data || []).map((r) => r.team_entry).filter((e) => e && e.season_id === seasonId
        && (!match || e.team_id === match.home?.id || e.team_id === match.away?.id));
      if (hits.length) setCaptainWarning(`${picked.label} captains ${hits.map((h) => h.team?.name || 'a team').join(', ')} in ${match ? 'this match' : 'this season'}. A captain scores their own team's match only with an explicit assignment like this one.`);
    })();
  }, [picked.id, picked.label, seasonId, matchId, matches]);

  const assign = async () => {
    if (!picked.id) { setError('Find and choose the scorer’s account first.'); return; }
    if (!seasonId) { setError('Choose a season; add a match to limit the assignment to one match.'); return; }
    setBusy('assign'); setError(''); setMessage('');
    const { error: err } = await supabase.rpc('assign_scorer', {
      p_user: picked.id,
      p_season: matchId ? null : seasonId,
      p_match: matchId || null,
      p_expires_at: expires ? new Date(expires).toISOString() : null,
    });
    setBusy('');
    if (err) setError(err.code === '23505' ? 'This scorer already has that assignment.' : err.message || 'Could not assign the scorer.');
    else { setMessage(`${picked.label} can now score ${matchId ? 'that match' : 'every match of the season'}.`); setPicked({ id: '', label: '' }); setExpires(''); }
    load();
  };

  const revoke = async (row) => {
    const who = state.labels[row.user_id] || 'this scorer';
    if (!window.confirm(`Revoke ${who}? Matches already scored keep their data.`)) return;
    setBusy(row.id); setError(''); setMessage('');
    const { error: err } = await supabase.rpc('revoke_scorer', { p_assignment: row.id });
    setBusy('');
    if (err) setError(err.message);
    else setMessage(`${who} no longer scores that assignment.`);
    load();
  };

  const options = search.results;
  return <div className="space-y-6 p-6">
    <div><h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-tight"><Activity size={20} /> Scorers</h2><p className="mt-1 text-xs uppercase tracking-widest text-zinc-500">Assign a scorer to a season or to one match. Scorers use Live Matches only; they cannot change fixtures, teams, rosters, roles or news.</p></div>
    {error && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
    {message && <p role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">{message}</p>}

    <section aria-label="Assignments" className="space-y-3">
      {state.status === 'loading' && <p className="flex items-center gap-2 text-zinc-500"><Loader2 size={14} className="animate-spin" /> Loading assignments...</p>}
      {state.status === 'error' && <p role="alert" className="text-sm text-red-300">Assignments could not be loaded ({state.error}). <button type="button" onClick={load} className="underline">Try again</button></p>}
      {state.status === 'ready' && !state.rows.length && <p className="text-zinc-500">No scorers are assigned yet.</p>}
      {state.status === 'ready' && state.rows.length > 0 && <ul aria-label="Scorer assignments" className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10">
        {state.rows.map((row) => <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 bg-black/30 p-4">
          <div className="min-w-0">
            <p className="break-words font-bold text-white">{state.labels[row.user_id] || 'An account that is no longer available'}</p>
            <p className="text-xs text-zinc-400">
              {row.match ? `${named(row.match)} (${row.match.season?.name ?? 'match'})` : `Every match of ${row.season?.division?.name ?? ''} ${row.season?.name ?? 'the season'}`}
              {' · '}{row.expires_at && new Date(row.expires_at) < new Date() ? <span className="text-amber-300">Expired {when(row.expires_at)}</span> : when(row.expires_at)}
            </p>
          </div>
          <button type="button" onClick={() => revoke(row)} disabled={busy !== ''} className="flex items-center gap-1 rounded-lg border border-red-500/30 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-red-400 disabled:opacity-40"><Trash2 size={13} /> Revoke</button>
        </li>)}
      </ul>}
    </section>

    <section aria-label="Assign a scorer" className="space-y-4 rounded-2xl border border-white/10 bg-white/[.03] p-5">
      <h3 className="text-sm font-black uppercase tracking-widest text-zinc-300">Assign a scorer</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <label className={labelClass}>Find an account
          <input type="search" aria-label="Find scorer" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or college email" className={`${inputClass} mt-1 normal-case tracking-normal`} />
        </label>
        <label className={labelClass}>Scorer
          <select aria-label="Scorer" value={picked.id} onChange={(e) => setPicked({ id: e.target.value, label: options.find((a) => a.user_id === e.target.value)?.label || '' })} className={`${inputClass} mt-1 normal-case tracking-normal`}>
            <option value="">{options.length ? 'Choose from the search results' : 'Search to choose an account'}</option>
            {options.map((a) => <option key={a.user_id} value={a.user_id}>{a.label}</option>)}
          </select>
        </label>
        <p aria-live="polite" className="text-xs text-zinc-500 md:col-span-2">
          {search.status === 'idle' && query.trim() && 'Type at least two letters.'}
          {search.status === 'loading' && <span className="inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Searching...</span>}
          {search.status === 'ready' && (options.length ? `${options.length} account${options.length === 1 ? '' : 's'} found` : 'No account matches.')}
          {search.status === 'error' && <span role="alert" className="text-red-300">Search failed ({search.error}). <button type="button" onClick={search.retry} className="underline">Try again</button></span>}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <label className={labelClass}>Division
          <select aria-label="Division" value={divisionId} onChange={(e) => chooseDivision(e.target.value)} className={`${inputClass} mt-1 normal-case tracking-normal`}>
            <option value="">{divisions.length ? 'Choose a division' : 'No divisions yet'}</option>
            {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className={labelClass}>Season
          <select aria-label="Season" value={seasonId} disabled={!divisionId} onChange={(e) => chooseSeason(e.target.value)} className={`${inputClass} mt-1 normal-case tracking-normal`}>
            <option value="">{divisionId && !seasons.length ? 'This division has no seasons' : 'Choose a season'}</option>
            {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_current ? ' (current)' : ''}</option>)}
          </select>
        </label>
        <label className={labelClass}>One match (optional)
          <select aria-label="Match" value={matchId} disabled={!seasonId} onChange={(e) => setMatchId(e.target.value)} className={`${inputClass} mt-1 normal-case tracking-normal`}>
            <option value="">Every match of the season</option>
            {matches.map((m) => <option key={m.id} value={m.id}>{named(m)} · {m.date ? new Date(m.date).toLocaleDateString() : 'no date'}</option>)}
          </select>
        </label>
        <label className={labelClass}>Expires (optional)
          <input type="datetime-local" aria-label="Expires" value={expires} onChange={(e) => setExpires(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
      </div>
      {captainWarning && <p role="note" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">{captainWarning}</p>}
      <button type="button" onClick={assign} disabled={busy !== '' || !picked.id || !seasonId} className="flex items-center gap-2 rounded-lg bg-[#d9ff4a] px-3 py-2 text-xs font-black uppercase text-black disabled:opacity-40">
        {busy === 'assign' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Assign scorer
      </button>
    </section>
  </div>;
}
