import { useEffect, useState } from 'react';
import { ImagePlus, Loader2, Plus, Save, Shield, Trash2, Users } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { API_BASE_URL } from '../../lib/api';

const API_URL = API_BASE_URL;

const divisions = [
  { value: 'mens', label: "Men's Division" },
  { value: 'womens', label: "Women's Division" },
  { value: 'freshers', label: 'Freshers' },
];
const positions = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'CF', 'ST'];
const blankTeam = () => ({ id: null, draftId: crypto.randomUUID(), team_name: '', division: 'mens', captain_id: '', team_members: [] });
const teamKey = (team) => team.id || team.draftId;

export default function ManageRegistrations() {
  const [registrations, setRegistrations] = useState([]);
  const [captains, setCaptains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [uploadingPlayer, setUploadingPlayer] = useState('');
  const [error, setError] = useState('');

  const loadRegistrations = async () => {
    setLoading(true);
    const [{ data, error: registrationsError }, { data: profiles, error: profilesError }] = await Promise.all([
      supabase.from('team_registrations').select('id, team_id, team_name, division, captain_id, team_members(*)').order('created_at', { ascending: false }),
      supabase.from('user_profiles').select('id, email, real_name, nickname').order('email', { ascending: true }),
    ]);
    if (registrationsError || profilesError) setError(registrationsError?.message || profilesError?.message || 'Could not load teams.');
    setCaptains((profiles || []).map((profile) => ({
      id: profile.id,
      label: profile.email || profile.id,
    })));
    setRegistrations(data || []);
    setLoading(false);
  };

  useEffect(() => { loadRegistrations(); }, []);

  const changeTeam = (id, field, value) => setRegistrations((current) => current.map((team) => teamKey(team) === id ? { ...team, [field]: value } : team));
  const addTeam = () => setRegistrations((current) => [blankTeam(), ...current]);
  const addPlayer = (teamId) => setRegistrations((current) => current.map((team) => teamKey(team) === teamId ? {
    ...team,
    team_members: [...team.team_members, { id: null, name: '', email: '', position: '', jersey_number: null, overall_rating: 50, attributes: {} }],
  } : team));
  const changePlayer = (teamId, index, field, value) => setRegistrations((current) => current.map((team) => teamKey(team) === teamId ? {
    ...team,
    team_members: team.team_members.map((member, memberIndex) => memberIndex === index ? { ...member, [field]: value } : member),
  } : team));

  const uploadPlayerImage = async (team, index, file) => {
    const player = team.team_members[index];
    if (!player.email?.trim()) {
      setError('Enter the player’s college email before uploading their image.');
      return;
    }
    if (!file?.type.includes('png') && !file?.name?.toLowerCase().endsWith('.png')) {
      setError('Player image must be in PNG format (.png). Please convert and upload a PNG file.');
      return;
    }
    const uploadKey = `${teamKey(team)}-${index}`;
    setUploadingPlayer(uploadKey);
    setError('');
    try {
      const sourceUrl = URL.createObjectURL(file);
      const image = new Image();
      image.src = sourceUrl;
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('Could not open that image.'));
      });
      const width = image.width;
      const height = image.height;
      URL.revokeObjectURL(sourceUrl);

      if (width !== 512 || height !== 512) {
        throw new Error(`Player image must be exactly 512 × 512 pixels (selected image is ${width} × ${height}). Please resize and upload again.`);
      }

      const formData = new FormData();
      formData.append('email', player.email.trim());
      formData.append('image', file, `${player.email.trim()}.png`);
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`${API_URL}/admin/freshers/player-image`, {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${session?.access_token}` },
        body: formData,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not upload the image.');
      changePlayer(teamKey(team), index, 'image_url', result.imageUrl);
    } catch (uploadError) {
      setError(uploadError.message || 'Could not upload the player image.');
    } finally {
      setUploadingPlayer('');
    }
  };

  const saveTeam = async (team) => {
    setSavingId(teamKey(team));
    setError('');
    try {
      if (!team.team_name.trim() || !team.captain_id) throw new Error('Enter a team name and assign a captain.');
      if (team.team_members.some((member) => !member.name.trim())) throw new Error('Every roster player needs a name.');
      const { data: { session } } = await supabase.auth.getSession();
      const saveResponse = await fetch(`${API_URL}/admin/team-registrations`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ id: team.id, team_id: team.team_id, team_name: team.team_name, division: team.division, captain_id: team.captain_id, members: team.team_members }),
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

  const removePlayer = async (team, index) => {
    const member = team.team_members[index];
    if (member.id) {
      const { error: deleteError } = await supabase.from('team_members').delete().eq('id', member.id);
      if (deleteError) { setError(deleteError.message); return; }
    }
    setRegistrations((current) => current.map((item) => teamKey(item) === teamKey(team) ? { ...item, team_members: item.team_members.filter((_, memberIndex) => memberIndex !== index) } : item));
  };

  const deleteTeam = async (id) => {
    if (!window.confirm('Delete this formed team and its roster?')) return;
    const { error: deleteError } = await supabase.from('team_registrations').delete().eq('id', id);
    if (deleteError) { setError(deleteError.message); return; }
    setRegistrations((current) => current.filter((team) => team.id !== id));
  };

  const assignedCaptainIds = new Set(registrations.filter((team) => team.id).map((team) => team.captain_id));
  const inputClass = 'w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-[#d9ff4a]/60';

  return <div className="space-y-6 p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-tight"><Users size={20} /> Formed teams</h2><p className="mt-1 text-xs uppercase tracking-widest text-zinc-500">Assign captains and build their player rosters</p></div>
      <button type="button" onClick={addTeam} className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-black"><Plus size={15} /> Form a team</button>
    </div>
    {error && <p className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
    {loading ? <p className="text-zinc-500">Loading teams...</p> : registrations.map((team, teamIndex) => {
      const options = captains.filter((captain) => !assignedCaptainIds.has(captain.id) || captain.id === team.captain_id);
      return <section key={teamKey(team) || `draft-${teamIndex}`} className="space-y-4 rounded-2xl border border-white/10 bg-white/[.03] p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_200px_1fr_auto]">
          <input value={team.team_name} onChange={(event) => changeTeam(teamKey(team), 'team_name', event.target.value)} placeholder="Team name" className={`${inputClass} font-bold`} />
          <select value={team.division} onChange={(event) => changeTeam(teamKey(team), 'division', event.target.value)} className={inputClass}>{divisions.map((division) => <option key={division.value} value={division.value}>{division.label}</option>)}</select>
          <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Captain college email<select value={team.captain_id} onChange={(event) => changeTeam(teamKey(team), 'captain_id', event.target.value)} className={`${inputClass} mt-1 normal-case tracking-normal`}><option value="">Select college email</option>{options.map((captain) => <option key={captain.id} value={captain.id}>{captain.label}</option>)}</select></label>
          <div className="flex gap-2"><button type="button" onClick={() => saveTeam(team)} disabled={savingId === teamKey(team)} className="flex items-center gap-2 rounded-lg bg-[#d9ff4a] px-3 py-2 text-xs font-black uppercase text-black"><Save size={14} /> Save</button>{team.id && <button type="button" onClick={() => deleteTeam(team.id)} className="rounded-lg border border-red-500/30 px-3 py-2 text-red-400" aria-label="Delete team"><Trash2 size={14} /></button>}</div>
        </div>
        <div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-zinc-300"><Shield size={15} /> Roster <span className="text-zinc-600">({team.team_members.length})</span></h3><button type="button" onClick={() => addPlayer(teamKey(team))} className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-[#d9ff4a]"><Plus size={14} /> Add player</button></div>
        {team.team_members.map((member, index) => <div key={member.id || `new-player-${teamKey(team)}-${index}`} className="grid gap-2 rounded-xl border border-white/5 bg-black/30 p-3 md:grid-cols-[1.2fr_1fr_160px_100px_auto]">
          <input value={member.name} onChange={(event) => changePlayer(teamKey(team), index, 'name', event.target.value)} placeholder="Player name" className={inputClass} />
          <input type="email" value={member.email || ''} onChange={(event) => changePlayer(teamKey(team), index, 'email', event.target.value)} placeholder="College email (for image upload)" className={inputClass} />
          <select value={member.position || ''} onChange={(event) => changePlayer(teamKey(team), index, 'position', event.target.value)} className={inputClass}><option value="">Position (captain sets)</option>{positions.map((position) => <option key={position}>{position}</option>)}</select>
          <input type="number" min="1" max="99" value={member.jersey_number || ''} onChange={(event) => changePlayer(teamKey(team), index, 'jersey_number', event.target.value)} placeholder="#" className={inputClass} />
          <button type="button" onClick={() => removePlayer(team, index)} className="grid place-items-center rounded-lg border border-red-500/20 px-3 text-red-400" aria-label="Remove player"><Trash2 size={15} /></button>
          <div className="flex items-center gap-3 md:col-span-5">
            {member.image_url ? <img src={member.image_url} alt={`${member.name || 'Player'} portrait preview`} className="h-12 w-12 rounded-lg border border-white/10 bg-white/5 object-contain" /> : <div className="grid h-12 w-12 place-items-center rounded-lg border border-white/10 bg-white/5 text-zinc-600"><Users size={18} /></div>}
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-zinc-300 hover:bg-white/5">
              {uploadingPlayer === `${teamKey(team)}-${index}` ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
              {member.image_url ? 'Replace player image' : 'Upload player image'}
              <input type="file" accept="image/png" className="sr-only" disabled={uploadingPlayer === `${teamKey(team)}-${index}`} onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadPlayerImage(team, index, file); event.target.value = ''; }} />
            </label>
            <span className="text-[10px] text-zinc-600">Must be a PNG format file with exact 512 × 512 resolution</span>
          </div>
        </div>)}
        {!team.team_members.length && <p className="text-xs text-zinc-600">Add players to this roster. The captain can then assign positions and playstyles.</p>}
      </section>;
    })}
    {!loading && !registrations.length && <p className="text-zinc-500">No teams formed yet. Create a team and assign its captain.</p>}
  </div>;
}
