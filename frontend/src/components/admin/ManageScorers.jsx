import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useLatestSearch } from '../../hooks/useLatestSearch';
import { CalendarClock, Search, Timer, Trophy } from 'lucide-react';
import { Button, DateTimeField, Field, Notice, Select, Combobox, Skeleton, TextInput, toast, useConfirm } from '../ui';

// Scorers. A scorer holds the scorer grant and an assignment scoped to one season (every match of it) or one match, with
// an optional expiry. The dictator assigns and revokes here through the dictator-only database functions
// (assign_scorer, revoke_scorer), which add or remove the grant with the last assignment. Assignments are listed with
// the person's directory label (verified email, name as context; never a profile email or raw id). Assigning someone
// who captains a team in that season or match shows a warning: a captain scores their own team's match only with an
// explicit assignment, and the warning makes that deliberate.
const when = (iso) => (iso ? new Date(iso).toLocaleString() : 'No expiry');
const named = (m) => `${m.home?.name ?? 'Home'} vs ${m.away?.name ?? 'Away'}`;

export default function ManageScorers({ person }) { // eslint-disable-line react/prop-types
  // person: the account chosen in Access control, so the one scorer flow starts from it.
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
  const latest = useRef({ list: 0, seasons: 0, matches: 0, warning: 0 });
  const confirm = useConfirm();
  useEffect(() => { if (person) setPicked({ id: person.user_id, label: person.label }); }, [person]);
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
    setBusy('assign'); setError('');
    const { error: err } = await supabase.rpc('assign_scorer', {
      p_user: picked.id,
      p_season: matchId ? null : seasonId,
      p_match: matchId || null,
      p_expires_at: expires ? new Date(expires).toISOString() : null,
    });
    setBusy('');
    if (err) setError(err.code === '23505' ? 'This scorer already has that assignment.' : err.message || 'Could not assign the scorer.');
    else { toast({ tone: 'success', title: 'Scorer assigned', description: `${picked.label} can now score ${matchId ? 'that match' : 'every match of the season'}.` }); setPicked({ id: '', label: '' }); setExpires(''); }
    load();
  };

  const revoke = async (row) => {
    const who = state.labels[row.user_id] || 'this scorer';
    const ok = await confirm({ title: `Revoke ${who}?`, description: 'Matches already scored keep their data.', confirmLabel: 'Revoke', tone: 'danger' });
    if (!ok) return;
    setBusy(row.id); setError('');
    const { error: err } = await supabase.rpc('revoke_scorer', { p_assignment: row.id });
    setBusy('');
    if (err) setError(err.message);
    else toast({ tone: 'success', title: 'Scorer revoked', description: `${who} no longer scores that assignment.` });
    load();
  };

  // The chosen person stays in the list even when a search has not returned them.
  const found = search.results;
  const options = picked.id && !found.some((a) => a.user_id === picked.id) ? [{ user_id: picked.id, label: picked.label }, ...found] : found;
  return <div className="space-y-6">
    {error && <Notice tone="error" role="alert">{error}</Notice>}

    <section aria-label="Assignments" className="space-y-3">
      {state.status === 'loading' && <Skeleton className="h-20 w-full rounded-card" />}
      {state.status === 'error' && <Notice tone="error" role="alert">Assignments could not be loaded ({state.error}). <Button variant="quiet" size="sm" onClick={load}>Try again</Button></Notice>}
      {state.status === 'ready' && !state.rows.length && <div className="flex flex-col items-start gap-2 rounded-card border border-dashed border-line p-6 text-sm text-mut">
        <Timer size={26} aria-hidden="true" />
        <p className="font-semibold text-ink">No scorers are assigned yet.</p>
        Assign someone below to score a season or a single match.
      </div>}
      {state.status === 'ready' && state.rows.length > 0 && <ul aria-label="Scorer assignments" className="glass divide-y divide-line/70 rounded-card px-2">
        {state.rows.map((row) => {
          const expired = row.expires_at && new Date(row.expires_at) < new Date();
          return <li key={row.id} className="flex flex-wrap items-center gap-3 p-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink/[0.07] text-ink">{row.match ? <CalendarClock size={18} aria-hidden="true" /> : <Trophy size={18} aria-hidden="true" />}</span>
            <div className="min-w-0 flex-1">
              <p className="break-words font-black uppercase tracking-tight text-ink">{state.labels[row.user_id] || 'An account that is no longer available'}</p>
              <p className="text-sm text-mut">
                {row.match ? `${named(row.match)} (${row.match.season?.name ?? 'match'})` : `Every match of ${row.season?.division?.name ?? ''} ${row.season?.name ?? 'the season'}`}
                {' · '}{expired ? <span className="text-live">Expired {when(row.expires_at)}</span> : when(row.expires_at)}
              </p>
            </div>
            <Button variant="quiet" size="sm" onClick={() => revoke(row)} disabled={busy !== ''} className="text-live">Revoke</Button>
          </li>;
        })}
      </ul>}
    </section>

    <section id="assign-scorer" aria-label="Assign a scorer" className="glass scroll-mt-28 space-y-5 rounded-card p-5">
      <h2 className="font-display text-2xl text-ink">Assign a scorer</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Find an account">{(p) => <TextInput {...p} icon={Search} type="search" aria-label="Find scorer" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or college email" />}</Field>
        <Field label="Scorer">{(p) => <Select {...p} aria-label="Scorer" value={picked.id}
          onChange={(id) => setPicked({ id, label: found.find((a) => a.user_id === id)?.label || picked.label })}
          placeholder={options.length ? 'Choose from the search results' : 'Search to choose an account'}
          options={options.map((a) => ({ value: a.user_id, label: a.label }))} />}</Field>
        <p aria-live="polite" className="text-sm text-mut md:col-span-2">
          {search.status === 'idle' && query.trim() && 'Type at least two letters.'}
          {search.status === 'loading' && 'Searching...'}
          {search.status === 'ready' && (options.length ? `${options.length} account${options.length === 1 ? '' : 's'} found` : 'No account matches.')}
          {search.status === 'error' && <span role="alert" className="text-live">Search failed ({search.error}). <Button variant="quiet" size="sm" onClick={search.retry}>Try again</Button></span>}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Division">{(p) => <Select {...p} aria-label="Division" value={divisionId} onChange={chooseDivision}
          placeholder={divisions.length ? 'Choose a division' : 'No divisions yet'} options={divisions.map((d) => ({ value: d.id, label: d.name }))} />}</Field>
        <Field label="Season">{(p) => <Select {...p} aria-label="Season" value={seasonId} disabled={!divisionId} onChange={chooseSeason}
          placeholder={divisionId && !seasons.length ? 'This division has no seasons' : 'Choose a season'}
          options={seasons.map((x) => ({ value: x.id, label: `${x.name}${x.is_current ? ' (current)' : ''}` }))} />}</Field>
        <Field label="One match (optional)">{(p) => <Combobox {...p} aria-label="Match" value={matchId} disabled={!seasonId} onChange={setMatchId}
          placeholder="Every match of the season" searchPlaceholder="Search teams"
          options={[{ value: '', label: 'Every match of the season' }, ...matches.map((m) => ({ value: m.id, label: named(m), description: m.date ? new Date(m.date).toLocaleDateString() : 'No date' }))]} />}</Field>
        <Field label="Expires (optional)">{(p) => <DateTimeField {...p} type="datetime-local" aria-label="Expires" value={expires} onChange={(e) => setExpires(e.target.value)} />}</Field>
      </div>
      {captainWarning && <Notice tone="warning" role="note">{captainWarning}</Notice>}
      <Button onClick={assign} disabled={busy !== '' || !picked.id || !seasonId}>{busy === 'assign' ? 'Assigning...' : 'Assign scorer'}</Button>
    </section>
  </div>;
}
