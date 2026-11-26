import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useLatestSearch } from '../../hooks/useLatestSearch';
import { Button, Card, Field, Notice, useConfirm } from '../ui';

// Captains. The dictator chooses division -> season -> team (as in Teams & Rosters) and sees only that team entry's
// captain for that season: labelled by the dictator-only account directory (verified email, name as context; never an
// editable profile email or a raw id). Assigning, changing and revoking go through the dictator-only database
// functions (assign_captain, revoke_captain), which add or remove the captain grant with the last writable assignment.
// A team entry has one captain; one person may captain several entries. The captain shown afterwards is always
// reloaded from the database. Every load is numbered: a late answer for an earlier choice is ignored, and choosing
// again clears what belonged to the previous choice.
export default function ManageCaptains() {
  const confirm = useConfirm();
  const [divisions, setDivisions] = useState([]);
  const [divisionId, setDivisionId] = useState('');
  const [seasons, setSeasons] = useState([]);
  const [seasonId, setSeasonId] = useState('');
  const [teams, setTeams] = useState([]);
  const [teamId, setTeamId] = useState('');
  const [assignment, setAssignment] = useState(null);
  const [captainLabel, setCaptainLabel] = useState('');
  const [picked, setPicked] = useState({ id: '', label: '' });
  const [loading, setLoading] = useState({ divisions: true, seasons: false, teams: false, registration: false });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const latest = useRef({ seasons: 0, teams: 0, registration: 0 });
  const isLoading = (key, value) => setLoading((current) => ({ ...current, [key]: value }));
  // Starts a numbered load; the returned check is false once a newer load of the same kind has started.
  const begin = (kind) => { const n = ++latest.current[kind]; return () => latest.current[kind] === n; };

  useEffect(() => {
    (async () => {
      const { data, error: err } = await supabase.from('divisions').select('id, slug, name').order('sort_order', { ascending: true });
      if (err) setError(err.message);
      setDivisions(data || []);
      isLoading('divisions', false);
    })();
  }, []);

  const loadSeasons = async (dId) => {
    const current = begin('seasons');
    isLoading('seasons', true);
    const { data, error: err } = await supabase.from('seasons').select('id, slug, name, is_current').eq('division_id', dId).order('sort_order', { ascending: true });
    if (!current()) return;
    if (err) setError(err.message);
    setSeasons(data || []);
    isLoading('seasons', false);
  };

  const loadTeams = async (sId) => {
    const current = begin('teams');
    isLoading('teams', true);
    const { data: entries, error: err } = await supabase.from('team_entries').select('team_id').eq('season_id', sId);
    const ids = (entries || []).map((e) => e.team_id);
    const { data: rows, error: teamsError } = ids.length ? await supabase.from('teams').select('id, name').in('id', ids) : { data: [], error: null };
    if (!current()) return;
    if (err || teamsError) setError((err || teamsError).message);
    setTeams((rows || []).sort((a, b) => a.name.localeCompare(b.name)));
    isLoading('teams', false);
  };

  // The selected team's entry in the selected season, its captain assignment, and the captain's label.
  const loadAssignment = async (sId, tId) => {
    const current = begin('registration');
    isLoading('registration', true);
    const { data: entry, error: entryError } = await supabase.from('team_entries').select('id').eq('season_id', sId).eq('team_id', tId).maybeSingle();
    const { data: row, error: err } = entry
      ? await supabase.from('captain_assignments').select('id, team_entry_id, user_id').eq('team_entry_id', entry.id).maybeSingle()
      : { data: null, error: null };
    const { data: people, error: peopleError } = row?.user_id
      ? await supabase.rpc('account_directory', { p_ids: [row.user_id], p_limit: 1 })
      : { data: [], error: null };
    if (!current()) return;
    if (entryError || err || peopleError) setError((entryError || err || peopleError).message);
    setAssignment({ entryId: entry?.id ?? null, row: row || null });
    setCaptainLabel(row?.user_id ? (people?.[0]?.label || 'An account that is no longer available') : '');
    isLoading('registration', false);
  };

  const clearBelow = (level) => {
    if (level <= 1) { setSeasons([]); setSeasonId(''); latest.current.seasons += 1; }
    if (level <= 2) { setTeams([]); setTeamId(''); latest.current.teams += 1; }
    setAssignment(null); setCaptainLabel(''); setPicked({ id: '', label: '' }); latest.current.registration += 1;
    setError(''); setMessage('');
  };
  const chooseDivision = (id) => { clearBelow(1); setDivisionId(id); if (id) loadSeasons(id); };
  const chooseSeason = (id) => { clearBelow(2); setSeasonId(id); if (id) loadTeams(id); };
  const chooseTeam = (id) => { clearBelow(3); setTeamId(id); if (id) loadAssignment(seasonId, id); };

  const division = divisions.find((d) => d.id === divisionId);
  const team = teams.find((t) => t.id === teamId);

  const entryId = assignment?.entryId;
  const current = assignment?.row;

  const saveCaptain = async () => {
    if (!picked.id) { setError('Find and choose the captain’s account first.'); return; }
    if (!entryId) { setError('This team is not entered in the season.'); return; }
    setBusy('save'); setError(''); setMessage('');
    // Changing an existing captain is explicit: the function refuses a second captain unless it is asked to replace.
    const { error: err } = await supabase.rpc('assign_captain', { p_entry: entryId, p_user: picked.id, p_replace: Boolean(current) });
    setBusy('');
    if (err) setError(err.code === '23505' ? 'This team already has a captain. Reload and choose Change captain.' : err.message || 'Could not save the captain.');
    else { setMessage(`${picked.label} is now the captain of ${team?.name}.`); setPicked({ id: '', label: '' }); }
    loadAssignment(seasonId, teamId); // show what the database now holds
  };

  const revokeCaptain = async () => {
    if (!current) return;
    if (!(await confirm({ title: `Revoke ${captainLabel}?`, description: `They stop being captain of ${team?.name}. The team, its season entry and its roster are kept.`, confirmLabel: 'Revoke captain', tone: 'danger' }))) return;
    setBusy('revoke'); setError(''); setMessage('');
    const { error: err } = await supabase.rpc('revoke_captain', { p_entry: entryId });
    setBusy('');
    if (err) setError(err.message);
    else setMessage(`${captainLabel} is no longer the captain of ${team?.name}.`);
    loadAssignment(seasonId, teamId);
  };

  return <div className="space-y-6">
    <div className="space-y-1">
      <h2 className="font-display text-2xl font-bold text-ink">Captains</h2>
      <p className="text-sm text-mut">Choose a division, season and team, then assign, change or revoke its captain.</p>
    </div>
    {error && <Notice tone="error" role="alert">{error}</Notice>}
    {message && <Notice tone="success" role="status">{message}</Notice>}

    <Card className="grid gap-4 md:grid-cols-3">
      <Field as="select" label="Division" aria-label="Division" value={divisionId} onChange={(e) => chooseDivision(e.target.value)}>
        <option value="">{loading.divisions ? 'Loading divisions...' : divisions.length ? 'Choose a division' : 'No divisions yet'}</option>
        {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </Field>
      <Field as="select" label="Season" aria-label="Season" value={seasonId} disabled={!divisionId || loading.seasons} onChange={(e) => chooseSeason(e.target.value)}>
        <option value="">{loading.seasons ? 'Loading seasons...' : divisionId && !seasons.length ? 'This division has no seasons' : 'Choose a season'}</option>
        {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_current ? ' (current)' : ''}</option>)}
      </Field>
      <Field as="select" label="Team" aria-label="Team" value={teamId} disabled={!seasonId || loading.teams} onChange={(e) => chooseTeam(e.target.value)}>
        <option value="">{loading.teams ? 'Loading teams...' : seasonId && !teams.length ? 'No teams in this season' : 'Choose a team'}</option>
        {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </Field>
    </Card>

    {teamId && <Card as="section" aria-label="Captain" className="space-y-5">
      {loading.registration ? <p className="text-sm text-mut">Loading the captain...</p> : <>
        <p className="text-ink">
          {current ? <>Captain of {team?.name} in this season: <strong className="font-semibold">{captainLabel}</strong></> : <>{team?.name} has no captain in this season.</>}
        </p>
        <CaptainField picked={picked} onPick={setPicked} currentCaptainId={current?.user_id} teamName={team?.name} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={saveCaptain} disabled={busy !== '' || !picked.id}>{busy === 'save' ? 'Saving...' : current ? 'Change captain' : 'Assign captain'}</Button>
          {current && <Button variant="quiet" onClick={revokeCaptain} disabled={busy !== ''} className="text-live">Revoke captain</Button>}
        </div>
        <p className="text-sm text-mut">Players for this team are managed in Teams and rosters.</p>
      </>}
    </Card>}
  </div>;
}

// Finds the captain's account: every word of a name or college email must match. A person may captain several team
// entries, so every account is offered; results are labelled by the account directory.
function CaptainField({ picked, onPick, currentCaptainId, teamName }) {
  const [query, setQuery] = useState('');
  const search = useLatestSearch((text) => supabase.rpc('account_directory', { p_query: text, p_limit: 20 }), query, { minLength: 2 });
  const options = search.results.filter((a) => a.user_id !== currentCaptainId);
  return <div className="grid gap-4 md:grid-cols-2">
    <Field type="search" label="Find an account" aria-label={`Find captain for ${teamName}`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or college email" />
    <Field as="select" label="New captain" aria-label={`New captain for ${teamName}`} value={picked.id} onChange={(e) => onPick({ id: e.target.value, label: options.find((a) => a.user_id === e.target.value)?.label || '' })}>
      <option value="">{options.length ? 'Choose from the search results' : 'Search to choose an account'}</option>
      {options.map((a) => <option key={a.user_id} value={a.user_id}>{a.label}</option>)}
    </Field>
    <p aria-live="polite" className="text-sm text-mut md:col-span-2">
      {search.status === 'idle' && query.trim() && 'Type at least two letters.'}
      {search.status === 'loading' && 'Searching...'}
      {search.status === 'ready' && (options.length ? `${options.length} account${options.length === 1 ? '' : 's'} found` : 'No account matches.')}
      {search.status === 'error' && <span role="alert" className="text-live">Search failed ({search.error}). <Button variant="quiet" size="sm" onClick={search.retry}>Try again</Button></span>}
    </p>
  </div>;
}
