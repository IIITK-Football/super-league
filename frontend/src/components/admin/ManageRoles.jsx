import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';

const roleOptions = [
  { value: 'default', label: 'No special role' },
  { value: 'captain', label: 'Captain' },
  { value: 'editor', label: 'Editor' },
  { value: 'dictator', label: 'Dictator' },
  { value: 'admin', label: 'Scorer' },
];

export default function ManageRoles({ currentUserId }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState('');
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
    setSavingUserId(userId);
    const { error: updateError } = await supabase.from('user_roles').upsert({ user_id: userId, role: nextRole });
    if (updateError) setError(updateError.message);
    else {
      setUsers((current) => current.map((user) => user.id === userId ? { ...user, role: nextRole } : user));
      setMessage('Role updated.');
    }
    setSavingUserId('');
  };

  return <div className="space-y-8 p-6">
    <div><h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-tight"><ShieldCheck size={21} /> Access control</h2><p className="mt-1 text-xs uppercase tracking-widest text-zinc-500">Choose a role beside a college email to update access</p></div>
    {(error || message) && <p className={error ? 'text-sm text-red-300' : 'text-sm text-emerald-300'}>{error || message}</p>}
    {loading ? <p className="text-zinc-500">Loading registered users...</p> : <div className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10">{users.map((user) => <div key={user.id} className="grid gap-3 bg-black/30 p-4 sm:grid-cols-[1fr_220px] sm:items-center"><div><p className="font-bold text-white">{user.email}</p>{user.real_name && <p className="mt-1 text-xs text-zinc-500">{user.real_name}</p>}</div><select value={user.role} onChange={(event) => updateRole(user.id, event.target.value)} disabled={savingUserId === user.id} aria-label={`Role for ${user.email}`} className="rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm text-white disabled:opacity-50">{roleOptions.map((option) => <option key={option.value} value={option.value} disabled={user.id === currentUserId && option.value !== 'dictator'}>{option.label}</option>)}</select></div>)}</div>}
  </div>;
}
