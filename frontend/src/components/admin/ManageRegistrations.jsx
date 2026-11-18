import { useEffect, useState } from 'react';
import { Plus, Save, Trash2, Users } from 'lucide-react';
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
  const [captains, setCaptains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState('');

  const loadRegistrations = async () => {
    setLoading(true);
    const [{ data, error: registrationsError }, { data: profiles, error: profilesError }] = await Promise.all([
      supabase.from('team_registrations').select('id, team_id, team_name, season_id, season:seasons(name, division:divisions(slug)), captain_id').order('created_at', { ascending: false }),
      supabase.from('user_profiles').select('id, email, real_name, nickname').order('email', { ascending: true }),
    ]);
    if (registrationsError || profilesError) setError(registrationsError?.message || profilesError?.message || 'Could not load teams.');
    setCaptains((profiles || []).map((profile) => ({
      id: profile.id,
      label: profile.email || profile.id,
    })));
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
    {error && <p className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
    {loading ? <p className="text-zinc-500">Loading teams...</p> : registrations.map((team, teamIndex) => {
      const options = captains.filter((captain) => !assignedCaptainIds.has(captain.id) || captain.id === team.captain_id);
      return <section key={teamKey(team) || `draft-${teamIndex}`} className="space-y-4 rounded-2xl border border-white/10 bg-white/[.03] p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_200px_1fr_auto]">
          <input value={team.team_name} onChange={(event) => changeTeam(teamKey(team), 'team_name', event.target.value)} placeholder="Team name" className={`${inputClass} font-bold`} />
          <select aria-label="Division" value={team.division || ''} onChange={(event) => changeTeam(teamKey(team), 'division', event.target.value)} className={inputClass}>{!team.division && <option value="">Choose a division</option>}{divisions.map((division) => <option key={division.slug} value={division.slug}>{division.name}{team.season && team.division === division.slug ? ` · ${team.season.name}` : ''}</option>)}</select>
          <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Captain college email<select value={team.captain_id} onChange={(event) => changeTeam(teamKey(team), 'captain_id', event.target.value)} className={`${inputClass} mt-1 normal-case tracking-normal`}><option value="">Select college email</option>{options.map((captain) => <option key={captain.id} value={captain.id}>{captain.label}</option>)}</select></label>
          <div className="flex gap-2"><button type="button" onClick={() => saveTeam(team)} disabled={savingId === teamKey(team)} className="flex items-center gap-2 rounded-lg bg-[#d9ff4a] px-3 py-2 text-xs font-black uppercase text-black"><Save size={14} /> Save</button>{team.id && <button type="button" onClick={() => deleteTeam(team.id)} className="rounded-lg border border-red-500/30 px-3 py-2 text-red-400" aria-label="Delete team"><Trash2 size={14} /></button>}</div>
        </div>
        <p className="text-xs text-zinc-600">Players for this team are managed in Teams &amp; Rosters.</p>
      </section>;
    })}
    {!loading && !registrations.length && <p className="text-zinc-500">No teams formed yet. Create a team and assign its captain.</p>}
  </div>;
}
