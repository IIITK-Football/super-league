import { useEffect, useState } from 'react';
import { ShieldCheck, UserMinus, UserPlus } from 'lucide-react';
import { supabase } from '../../lib/supabase';

const roleOptions = ['default', 'captain', 'editor', 'dictator'];

export default function ManageRoles({ currentUserId }) {
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('captain');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadUsers = async () => {
    setLoading(true);
    const { data: profiles, error: profilesError } = await supabase
      .from('user_profiles')
      .select('id, email, real_name')
      .order('email');
    if (profilesError) {
      setError(profilesError.message);
      setLoading(false);
      return;
    }

    const { data: roles, error: rolesError } = await supabase.from('user_roles').select('user_id, role');
    if (rolesError) setError(rolesError.message);
    const roleByUser = new Map((roles || []).map((record) => [record.user_id, record.role]));
    setUsers((profiles || []).map((profile) => ({ ...profile, role: roleByUser.get(profile.id) || 'default' })));
    setLoading(false);
  };

  useEffect(() => { loadUsers(); }, []);

  const updateRole = async (userId, nextRole) => {
    if (userId === currentUserId && nextRole !== 'dictator') {
      setError('You cannot remove your own dictator access here.');
      return;
    }
    setError('');
    setMessage('');
    const { error: updateError } = await supabase.from('user_roles').upsert({ user_id: userId, role: nextRole });
    if (updateError) setError(updateError.message);
    else {
      setUsers((current) => current.map((user) => user.id === userId ? { ...user, role: nextRole } : user));
      setMessage('Role updated.');
    }
  };

  const assignByEmail = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    const foundUser = users.find((user) => user.email?.toLowerCase() === email.trim().toLowerCase());
    if (!foundUser) {
      setError('No registered user was found with that college email. Ask them to create an account first.');
      return;
    }
    setSaving(true);
    await updateRole(foundUser.id, role);
    setEmail('');
    setSaving(false);
  };

  return <div className="space-y-8 p-6">
    <div><h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-tight"><ShieldCheck size={21} /> Access control</h2><p className="mt-1 text-xs uppercase tracking-widest text-zinc-500">Only dictators can assign or remove roles</p></div>
    <form onSubmit={assignByEmail} className="grid gap-3 rounded-2xl border border-white/10 bg-white/[.03] p-5 md:grid-cols-[1fr_180px_auto]">
      <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teammate@iiitkottayam.ac.in" className="rounded-lg border border-white/10 bg-black/50 px-3 py-3 text-white outline-none focus:border-white/40" required />
      <select value={role} onChange={(event) => setRole(event.target.value)} className="rounded-lg border border-white/10 bg-black/50 px-3 py-3 text-white">{roleOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select>
      <button type="submit" disabled={saving} className="flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-3 text-xs font-black uppercase text-black"><UserPlus size={15} /> Assign role</button>
    </form>
    {(error || message) && <p className={error ? 'text-sm text-red-300' : 'text-sm text-emerald-300'}>{error || message}</p>}
    {loading ? <p className="text-zinc-500">Loading registered users...</p> : <div className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10">{users.map((user) => <div key={user.id} className="grid gap-3 bg-black/30 p-4 md:grid-cols-[1fr_180px_auto] md:items-center"><div><p className="font-bold text-white">{user.real_name || user.email}</p><p className="text-xs text-zinc-500">{user.email}</p></div><select value={user.role} onChange={(event) => updateRole(user.id, event.target.value)} disabled={user.id === currentUserId} className="rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm capitalize text-white">{roleOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select><button type="button" onClick={() => updateRole(user.id, 'default')} disabled={user.id === currentUserId || user.role === 'default'} className="flex items-center justify-center gap-2 rounded-lg border border-red-500/30 px-3 py-2 text-xs font-bold uppercase text-red-300 disabled:opacity-30"><UserMinus size={14} /> Remove role</button></div>)}</div>}
  </div>;
}