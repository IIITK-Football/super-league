import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useLatestSearch } from '../../hooks/useLatestSearch';
import { Crown, Search, UserRoundX } from 'lucide-react';
import { Button, Crest, Field, Notice, Select, Skeleton, TextInput, toast, useConfirm } from '../ui';

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
    const { data: rows, error: teamsError } = ids.length ? await supabase.from('teams').select('id, name, logo_url, team_color').in('id', ids) : { data: [], error: null };
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
    setError('');
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
    setBusy('save'); setError('');
    // Changing an existing captain is explicit: the function refuses a second captain unless it is asked to replace.
    const { error: err } = await supabase.rpc('assign_captain', { p_entry: entryId, p_user: picked.id, p_replace: Boolean(current) });
    setBusy('');
    if (err) setError(err.code === '23505' ? 'This team already has a captain. Reload and choose Change captain.' : err.message || 'Could not save the captain.');
    else { toast({ tone: 'success', title: 'Captain saved', description: `${picked.label} is now the captain of ${team?.name}.` }); setPicked({ id: '', label: '' }); }
    loadAssignment(seasonId, teamId); // show what the database now holds
  };

  const revokeCaptain = async () => {
    if (!current) return;
    if (!(await confirm({ title: `Revoke ${captainLabel}?`, description: `They stop being captain of ${team?.name}. The team, its season entry and its roster are kept.`, confirmLabel: 'Revoke captain', tone: 'danger' }))) return;
    setBusy('revoke'); setError('');
    const { error: err } = await supabase.rpc('revoke_captain', { p_entry: entryId });
    setBusy('');
    if (err) setError(err.message);
    else toast({ tone: 'success', title: 'Captain revoked', description: `${captainLabel} is no longer the captain of ${team?.name}.` });
    loadAssignment(seasonId, teamId);
  };

  const crest = (t) => <Crest name={t.name} src={t.logo_url} color={t.team_color} size="sm" />;
  return <div className="space-y-6">
    {error && <Notice tone="error" role="alert">{error}</Notice>}

    <div className="glass grid gap-4 rounded-card p-5 md:grid-cols-3">
      <Field label="Division">{(p) => <Select {...p} value={divisionId} onChange={chooseDivision} disabled={loading.divisions}
        placeholder={loading.divisions ? 'Loading divisions...' : divisions.length ? 'Choose a division' : 'No divisions yet'}
        options={divisions.map((d) => ({ value: d.id, label: d.name }))} />}</Field>
      <Field label="Season">{(p) => <Select {...p} value={seasonId} onChange={chooseSeason} disabled={!divisionId || loading.seasons}
        placeholder={loading.seasons ? 'Loading seasons...' : divisionId && !seasons.length ? 'This division has no seasons' : 'Choose a season'}
        options={seasons.map((x) => ({ value: x.id, label: `${x.name}${x.is_current ? ' (current)' : ''}` }))} />}</Field>
      <Field label="Team">{(p) => <Select {...p} value={teamId} onChange={chooseTeam} disabled={!seasonId || loading.teams}
        placeholder={loading.teams ? 'Loading teams...' : seasonId && !teams.length ? 'No teams in this season' : 'Choose a team'}
        options={teams.map((t) => ({ value: t.id, label: t.name, icon: crest(t) }))} />}</Field>
    </div>

    {!teamId && <div className="flex flex-col items-start gap-2 rounded-card border border-dashed border-line p-6 text-sm text-mut">
      <Crown size={26} aria-hidden="true" />
      Pick a division, a season and a team to see who captains it.
    </div>}

    {teamId && <section aria-label="Captain" className="glass space-y-5 rounded-card p-5">
      {loading.registration ? <Skeleton className="h-16 w-full" /> : <>
        <div className="flex items-center gap-4">
          {team && <Crest name={team.name} src={team.logo_url} color={team.team_color} size="lg" />}
          <div className="min-w-0">
            <p className="eyebrow">{team?.name}</p>
            <p className="text-ink">
              {current ? <>Captain of {team?.name} in this season: <strong className="font-black">{captainLabel}</strong></> : <span className="inline-flex items-center gap-2"><UserRoundX size={16} aria-hidden="true" className="text-mut" />{team?.name} has no captain in this season.</span>}
            </p>
          </div>
        </div>
        <CaptainField picked={picked} onPick={setPicked} currentCaptainId={current?.user_id} teamName={team?.name} />
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={saveCaptain} disabled={busy !== '' || !picked.id}>{busy === 'save' ? 'Saving...' : current ? 'Change captain' : 'Assign captain'}</Button>
          {current && <Button variant="quiet" onClick={revokeCaptain} disabled={busy !== ''} className="text-live">Revoke captain</Button>}
          <span className="text-sm text-mut sm:ml-auto">Players are managed in Teams and rosters.</span>
        </div>
      </>}
    </section>}
  </div>;
}

// Finds the captain's account: every word of a name or college email must match. A person may captain several team
// entries, so every account is offered; results are labelled by the account directory.
function CaptainField({ picked, onPick, currentCaptainId, teamName }) {
  const [query, setQuery] = useState('');
  const search = useLatestSearch((text) => supabase.rpc('account_directory', { p_query: text, p_limit: 20 }), query, { minLength: 2 });
  const options = search.results.filter((a) => a.user_id !== currentCaptainId);
  return <div className="grid gap-4 md:grid-cols-2">
    <Field label="Find an account">{(p) => <TextInput {...p} icon={Search} type="search" aria-label={`Find captain for ${teamName}`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or college email" />}</Field>
    <Field label="New captain">{(p) => <Select {...p} aria-label={`New captain for ${teamName}`} value={picked.id}
      onChange={(id) => onPick({ id, label: options.find((a) => a.user_id === id)?.label || '' })}
      placeholder={options.length ? 'Choose from the search results' : 'Search to choose an account'}
      options={options.map((a) => ({ value: a.user_id, label: a.label }))} />}</Field>
    <p aria-live="polite" className="text-sm text-mut md:col-span-2">
      {search.status === 'idle' && query.trim() && 'Type at least two letters.'}
      {search.status === 'loading' && 'Searching...'}
      {search.status === 'ready' && (options.length ? `${options.length} account${options.length === 1 ? '' : 's'} found` : 'No account matches.')}
      {search.status === 'error' && <span role="alert" className="text-live">Search failed ({search.error}). <Button variant="quiet" size="sm" onClick={search.retry}>Try again</Button></span>}
    </p>
  </div>;
}
