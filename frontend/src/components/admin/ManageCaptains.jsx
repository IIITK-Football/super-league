import { useEffect, useRef, useState } from 'react';
import { Loader2, Save, Trash2, Users } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useLatestSearch } from '../../hooks/useLatestSearch';

// Captains. The dictator chooses division -> season -> team (as in Teams & Rosters) and sees only that team entry's
// captain for that season: labelled by the dictator-only account directory (verified email, name as context; never an
// editable profile email or a raw id). Assigning, changing and revoking go through the dictator-only database
// functions (assign_captain, revoke_captain), which add or remove the captain grant with the last writable assignment.
// A team entry has one captain; one person may captain several entries. The captain shown afterwards is always
// reloaded from the database. Every load is numbered: a late answer for an earlier choice is ignored, and choosing
// again clears what belonged to the previous choice.
const inputClass = 'w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-[#d9ff4a]/60';
const labelClass = 'text-[10px] font-black uppercase tracking-widest text-zinc-500';

export default function ManageCaptains() {
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
    if (!window.confirm(`Revoke ${captainLabel} as captain of ${team?.name}? The team, its season entry and its roster are kept.`)) return;
    setBusy('revoke'); setError(''); setMessage('');
    const { error: err } = await supabase.rpc('revoke_captain', { p_entry: entryId });
    setBusy('');
    if (err) setError(err.message);
    else setMessage(`${captainLabel} is no longer the captain of ${team?.name}.`);
    loadAssignment(seasonId, teamId);
  };

  return <div className="space-y-6 p-6">
    <div><h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-tight"><Users size={20} /> Captains</h2><p className="mt-1 text-xs uppercase tracking-widest text-zinc-500">Choose a division, season and team, then assign, change or revoke its captain</p></div>
    {error && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
    {message && <p role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">{message}</p>}

    <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/[.03] p-5 md:grid-cols-3">
      <label className={labelClass}>Division
        <select aria-label="Division" value={divisionId} onChange={(e) => chooseDivision(e.target.value)} className={`${inputClass} mt-1 normal-case tracking-normal`}>
          <option value="">{loading.divisions ? 'Loading divisions...' : divisions.length ? 'Choose a division' : 'No divisions yet'}</option>
          {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </label>
      <label className={labelClass}>Season
        <select aria-label="Season" value={seasonId} disabled={!divisionId || loading.seasons} onChange={(e) => chooseSeason(e.target.value)} className={`${inputClass} mt-1 normal-case tracking-normal`}>
          <option value="">{loading.seasons ? 'Loading seasons...' : divisionId && !seasons.length ? 'This division has no seasons' : 'Choose a season'}</option>
          {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_current ? ' (current)' : ''}</option>)}
        </select>
      </label>
      <label className={labelClass}>Team
        <select aria-label="Team" value={teamId} disabled={!seasonId || loading.teams} onChange={(e) => chooseTeam(e.target.value)} className={`${inputClass} mt-1 normal-case tracking-normal`}>
          <option value="">{loading.teams ? 'Loading teams...' : seasonId && !teams.length ? 'No teams in this season' : 'Choose a team'}</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
    </div>

    {teamId && <section aria-label="Captain" className="space-y-4 rounded-2xl border border-white/10 bg-white/[.03] p-5">
      {loading.registration ? <p className="flex items-center gap-2 text-zinc-500"><Loader2 size={14} className="animate-spin" /> Loading the captain...</p> : <>
        <p className="text-sm text-zinc-300">
          {current ? <>Captain of {team?.name} in this season: <strong className="text-white">{captainLabel}</strong></> : <>{team?.name} has no captain in this season.</>}
        </p>
        <CaptainField picked={picked} onPick={setPicked} currentCaptainId={current?.user_id} teamName={team?.name} />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={saveCaptain} disabled={busy !== '' || !picked.id} className="flex items-center gap-2 rounded-lg bg-[#d9ff4a] px-3 py-2 text-xs font-black uppercase text-black disabled:opacity-40">
            {busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {current ? 'Change captain' : 'Assign captain'}
          </button>
          {current && <button type="button" onClick={revokeCaptain} disabled={busy !== ''} className="flex items-center gap-1 rounded-lg border border-red-500/30 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-red-400 disabled:opacity-40"><Trash2 size={13} /> Revoke captain</button>}
        </div>
        <p className="text-xs text-zinc-600">Players for this team are managed in Teams &amp; Rosters.</p>
      </>}
    </section>}
  </div>;
}

// Finds the captain's account: every word of a name or college email must match. A person may captain several team
// entries, so every account is offered; results are labelled by the account directory.
/* eslint-disable react/prop-types -- this codebase does not use prop-types */
function CaptainField({ picked, onPick, currentCaptainId, teamName }) {
  const [query, setQuery] = useState('');
  const search = useLatestSearch((text) => supabase.rpc('account_directory', { p_query: text, p_limit: 20 }), query, { minLength: 2 });
  const options = search.results.filter((a) => a.user_id !== currentCaptainId);
  return <div className="grid gap-3 md:grid-cols-2">
    <label className={labelClass}>Find an account
      <input type="search" aria-label={`Find captain for ${teamName}`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or college email" className={`${inputClass} mt-1 normal-case tracking-normal`} />
    </label>
    <label className={labelClass}>New captain
      <select aria-label={`New captain for ${teamName}`} value={picked.id} onChange={(e) => onPick({ id: e.target.value, label: options.find((a) => a.user_id === e.target.value)?.label || '' })} className={`${inputClass} mt-1 normal-case tracking-normal`}>
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
  </div>;
}
/* eslint-enable react/prop-types */
