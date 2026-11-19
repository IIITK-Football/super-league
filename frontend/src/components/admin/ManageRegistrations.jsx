import { useEffect, useState } from 'react';
import { Loader2, Plus, Save, Trash2, Users } from 'lucide-react';
import { useLatestSearch } from '../../hooks/useLatestSearch';
import { supabase } from '../../lib/supabase';
import { API_BASE_URL } from '../../lib/api';
import { useDivisions } from '../../hooks/useDivisions';

const API_URL = API_BASE_URL;

// A registration belongs to a season of a division. New teams join the chosen division's current season; an existing
// team keeps its season unless its division is changed.
// Players and season rosters are managed in Teams & Rosters (ManageRosters); this screen registers a team for a season
// and assigns its captain.
const blankTeam = (division = 'freshers') => ({ id: null, draftId: crypto.randomUUID(), team_name: '', division, season_id: null, saved_division: null, captain_id: '' });
const teamKey = (team) => team.id || team.draftId;

export default function ManageRegistrations() {
  const { divisions } = useDivisions();
  const [registrations, setRegistrations] = useState([]);
  const [captainLabels, setCaptainLabels] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState('');

  const loadRegistrations = async () => {
    setLoading(true);
    const { data, error: registrationsError } = await supabase.from('team_registrations')
      .select('id, team_id, team_name, season_id, season:seasons(name, division:divisions(slug)), captain_id').order('created_at', { ascending: false });
    // Current captains are labelled by the dictator-only account directory (verified email, name as context).
    const ids = [...new Set((data || []).map((r) => r.captain_id).filter(Boolean))];
    const { data: people, error: peopleError } = ids.length
      ? await supabase.rpc('account_directory', { p_ids: ids, p_limit: 200 })
      : { data: [], error: null };
    if (registrationsError || peopleError) setError(registrationsError?.message || peopleError?.message || 'Could not load teams.');
    setCaptainLabels(Object.fromEntries((people || []).map((p) => [p.user_id, p.label])));
    setRegistrations((data || []).map((r) => {
      const slug = r.season?.division?.slug || null;
      return { ...r, division: slug, saved_division: slug };
    }));
    setLoading(false);
  };

  useEffect(() => { loadRegistrations(); }, []);

  const changeTeam = (id, field, value) => setRegistrations((current) => current.map((team) => teamKey(team) === id ? { ...team, [field]: value } : team));
  const addTeam = () => setRegistrations((current) => [blankTeam(divisions.some((d) => d.slug === 'freshers') ? 'freshers' : divisions[0]?.slug), ...current]);
  const saveTeam = async (team) => {
    setSavingId(teamKey(team));
    setError('');
    try {
      if (!team.team_name.trim() || !team.captain_id) throw new Error('Enter a team name and assign a captain.');
      const { data: { session } } = await supabase.auth.getSession();
      const saveResponse = await fetch(`${API_URL}/admin/team-registrations`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          id: team.id, team_id: team.team_id, team_name: team.team_name, division: team.division,
          ...(team.season_id && team.division === team.saved_division ? { season: team.season_id } : {}),
          captain_id: team.captain_id,
        }),
      });
      const saveResult = await saveResponse.json();
      if (!saveResponse.ok) throw new Error(`${saveResult.message || 'Could not save the team registration.'} (HTTP ${saveResponse.status})`);
      await loadRegistrations();
    } catch (saveError) {
      setError(saveError.message || 'Could not save this team.');
    } finally {
      setSavingId(null);
    }
  };

  const deleteTeam = async (id) => {
    if (!window.confirm('Delete this registration? The team, its season entry and its roster are kept.')) return;
    const { error: deleteError } = await supabase.from('team_registrations').delete().eq('id', id);
    if (deleteError) { setError(deleteError.message); return; }
    setRegistrations((current) => current.filter((team) => team.id !== id));
  };

  const assignedCaptainIds = new Set(registrations.filter((team) => team.id).map((team) => team.captain_id));
  const inputClass = 'w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-[#d9ff4a]/60';

  return <div className="space-y-6 p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-tight"><Users size={20} /> Captains &amp; registrations</h2><p className="mt-1 text-xs uppercase tracking-widest text-zinc-500">Register teams for a season and assign their captains</p></div>
      <button type="button" onClick={addTeam} className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-black"><Plus size={15} /> Form a team</button>
    </div>
    {error && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
    {loading ? <p className="text-zinc-500">Loading teams...</p> : registrations.map((team, teamIndex) => {
      return <section key={teamKey(team) || `draft-${teamIndex}`} className="space-y-4 rounded-2xl border border-white/10 bg-white/[.03] p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_200px_1fr_auto]">
          <input value={team.team_name} onChange={(event) => changeTeam(teamKey(team), 'team_name', event.target.value)} placeholder="Team name" className={`${inputClass} font-bold`} />
          <select aria-label="Division" value={team.division || ''} onChange={(event) => changeTeam(teamKey(team), 'division', event.target.value)} className={inputClass}>{!team.division && <option value="">Choose a division</option>}{divisions.map((division) => <option key={division.slug} value={division.slug}>{division.name}{team.season && team.division === division.slug ? ` · ${team.season.name}` : ''}</option>)}</select>
          <CaptainField team={team} labels={captainLabels} assigned={assignedCaptainIds} inputClass={inputClass}
            onPick={(id, label) => { changeTeam(teamKey(team), 'captain_id', id); if (id) setCaptainLabels((current) => ({ ...current, [id]: label })); }} />
          <div className="flex gap-2"><button type="button" onClick={() => saveTeam(team)} disabled={savingId === teamKey(team)} className="flex items-center gap-2 rounded-lg bg-[#d9ff4a] px-3 py-2 text-xs font-black uppercase text-black"><Save size={14} /> Save</button>{team.id && <button type="button" onClick={() => deleteTeam(team.id)} className="rounded-lg border border-red-500/30 px-3 py-2 text-red-400" aria-label="Delete team"><Trash2 size={14} /></button>}</div>
        </div>
        <p className="text-xs text-zinc-600">Players for this team are managed in Teams &amp; Rosters.</p>
      </section>;
    })}
    {!loading && !registrations.length && <p className="text-zinc-500">No teams formed yet. Create a team and assign its captain.</p>}
  </div>;
}

// The captain of one team: search accounts by name or college email (each word must match), then pick one. Accounts
// are labelled by the dictator-only account directory (verified email, name as context), never by an editable profile
// email or a raw id. Accounts already captaining another team are not offered.
/* eslint-disable react/prop-types -- this codebase does not use prop-types */
function CaptainField({ team, labels, assigned, inputClass, onPick }) {
  const [query, setQuery] = useState('');
  const search = useLatestSearch((text) => supabase.rpc('account_directory', { p_query: text, p_limit: 20 }), query, { minLength: 2 });
  const options = search.results.filter((a) => a.user_id === team.captain_id || !assigned.has(a.user_id));
  const current = team.captain_id ? (labels[team.captain_id] || 'Current captain') : '';
  return <div className="space-y-1 text-[10px] font-black uppercase tracking-widest text-zinc-500">
    <label className="block">Find captain account
      <input type="search" aria-label={`Find captain for ${team.team_name || 'new team'}`} value={query} onChange={(e) => setQuery(e.target.value)}
        placeholder="Name or college email" className={`${inputClass} mt-1 normal-case tracking-normal`} />
    </label>
    <label className="block">Captain
      <select aria-label={`Captain for ${team.team_name || 'new team'}`} value={team.captain_id || ''}
        onChange={(e) => onPick(e.target.value, options.find((a) => a.user_id === e.target.value)?.label)} className={`${inputClass} mt-1 normal-case tracking-normal`}>
        <option value="">{current ? 'No captain' : 'Choose from the search results'}</option>
        {team.captain_id && !options.some((a) => a.user_id === team.captain_id) && <option value={team.captain_id}>{current}</option>}
        {options.map((a) => <option key={a.user_id} value={a.user_id}>{a.label}</option>)}
      </select>
    </label>
    <p aria-live="polite" className="normal-case tracking-normal text-zinc-500">
      {search.status === 'idle' && query.trim() && 'Type at least two letters.'}
      {search.status === 'loading' && <span className="inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Searching...</span>}
      {search.status === 'ready' && (options.length ? `${options.length} account${options.length === 1 ? '' : 's'} found` : 'No free account matches. Accounts already captaining a team are not listed.')}
      {search.status === 'error' && <span role="alert" className="text-red-300">Search failed ({search.error}). <button type="button" onClick={search.retry} className="underline">Try again</button></span>}
    </p>
  </div>;
}
/* eslint-enable react/prop-types */
