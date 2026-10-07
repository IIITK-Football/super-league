import { useEffect, useState } from 'react';
import { Save, Trash2, Users } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export default function ManageRegistrations() {
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  const loadRegistrations = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('team_registrations')
      .select('id, team_name, division, captain_id, team_members(id, name, email, position)')
      .order('created_at', { ascending: false });
    setRegistrations(data || []);
    setLoading(false);
  };

  useEffect(() => { loadRegistrations(); }, []);

  const updateRegistration = async (registration) => {
    setSavingId(registration.id);
    await supabase.from('team_registrations').update({ team_name: registration.team_name, division: registration.division }).eq('id', registration.id);
    await supabase.from('team_members').upsert(registration.team_members.map((member) => ({ ...member, registration_id: registration.id })), { onConflict: 'id' });
    setSavingId(null);
  };

  const deleteRegistration = async (id) => {
    if (!window.confirm('Delete this submitted team?')) return;
    await supabase.from('team_registrations').delete().eq('id', id);
    setRegistrations((current) => current.filter((registration) => registration.id !== id));
  };

  const changeRegistration = (id, field, value) => setRegistrations((current) => current.map((registration) => registration.id === id ? { ...registration, [field]: value } : registration));
  const changeMember = (registrationId, memberId, field, value) => setRegistrations((current) => current.map((registration) => registration.id === registrationId ? { ...registration, team_members: registration.team_members.map((member) => member.id === memberId ? { ...member, [field]: value } : member) } : registration));

  return <div className="p-6 space-y-6">
    <div><h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-tight"><Users size={20} /> Formed teams</h2><p className="mt-1 text-xs uppercase tracking-widest text-zinc-500">Dictator controls for captain submissions</p></div>
    {loading ? <p className="text-zinc-500">Loading registrations...</p> : registrations.map((registration) => <section key={registration.id} className="space-y-4 rounded-2xl border border-white/10 bg-white/[.03] p-5">
      <div className="grid gap-3 md:grid-cols-[1fr_220px_auto]">
        <input value={registration.team_name} onChange={(event) => changeRegistration(registration.id, 'team_name', event.target.value)} className="rounded-lg border border-white/10 bg-black/50 px-3 py-2 font-bold text-white" />
        <select value={registration.division} onChange={(event) => changeRegistration(registration.id, 'division', event.target.value)} className="rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-white"><option value="mens">Super League</option><option value="womens">WSL</option><option value="freshers">Freshers</option></select>
        <div className="flex gap-2"><button onClick={() => updateRegistration(registration)} disabled={savingId === registration.id} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-black uppercase text-black"><Save size={14} /> Save</button><button onClick={() => deleteRegistration(registration.id)} className="rounded-lg border border-red-500/30 px-3 py-2 text-red-400"><Trash2 size={14} /></button></div>
      </div>
      <div className="grid gap-2 md:grid-cols-2">{registration.team_members.map((member) => <div key={member.id} className="grid grid-cols-3 gap-2"><input value={member.name} onChange={(event) => changeMember(registration.id, member.id, 'name', event.target.value)} className="rounded border border-white/10 bg-black/40 px-2 py-2 text-sm text-white" /><input value={member.email || ''} onChange={(event) => changeMember(registration.id, member.id, 'email', event.target.value)} className="rounded border border-white/10 bg-black/40 px-2 py-2 text-sm text-zinc-300" /><input value={member.position || ''} onChange={(event) => changeMember(registration.id, member.id, 'position', event.target.value)} className="rounded border border-white/10 bg-black/40 px-2 py-2 text-sm text-zinc-300" /></div>)}</div>
    </section>)}
    {!loading && registrations.length === 0 && <p className="text-zinc-500">No captain teams submitted yet.</p>}
  </div>;
}