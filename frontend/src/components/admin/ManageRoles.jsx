import { useState } from 'react';
import { Loader2, Search, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useLatestSearch } from '../../hooks/useLatestSearch';

const roleOptions = [
  { value: 'default', label: 'No special role' },
  { value: 'captain', label: 'Captain' },
  { value: 'editor', label: 'Editor' },
  { value: 'dictator', label: 'Dictator' },
];
export const PAGE_LIMIT = 50;

// Access control. Accounts come from the dictator-only account directory: each is labelled by the verified sign-in
// email from Supabase Auth with the profile name as context, never by the self-editable profile email or a raw id.
// Searching matches every word of the name or email; role changes write user_roles (row level security decides).
export default function ManageRoles({ currentUserId }) { // eslint-disable-line react/prop-types
  const [query, setQuery] = useState('');
  const [changed, setChanged] = useState({});
  const [savingUserId, setSavingUserId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const search = useLatestSearch(
    (text) => supabase.rpc('account_directory', { p_query: text || null, p_limit: PAGE_LIMIT }),
    query,
  );
  const accounts = search.results.map((a) => ({ ...a, role: changed[a.user_id] ?? a.role }));

  const updateRole = async (account, nextRole) => {
    if (account.user_id === currentUserId && nextRole !== 'dictator') {
      setError('You cannot remove your own dictator access here.');
      return;
    }
    setError('');
    setMessage('');
    setSavingUserId(account.user_id);
    const { error: updateError } = await supabase.from('user_roles').upsert({ user_id: account.user_id, role: nextRole });
    if (updateError) setError(updateError.message);
    else {
      setChanged((current) => ({ ...current, [account.user_id]: nextRole }));
      setMessage(`Role updated for ${account.label}.`);
    }
    setSavingUserId('');
  };

  const summary = search.status === 'ready' && accounts.length
    ? `${accounts.length} account${accounts.length === 1 ? '' : 's'}${accounts.length === PAGE_LIMIT ? ` shown (the first ${PAGE_LIMIT}; search to narrow)` : ''}`
    : '';

  return <div className="space-y-6 p-6">
    <div><h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-tight"><ShieldCheck size={21} /> Access control</h2><p className="mt-1 text-xs uppercase tracking-widest text-zinc-500">Find an account by name or college email, then choose its role</p></div>
    <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500">Search accounts
      <span className="mt-1 flex items-center gap-2 rounded-lg border border-white/10 bg-black/50 px-3 focus-within:border-[#d9ff4a]/60">
        <Search size={14} className="text-zinc-500" aria-hidden="true" />
        <input type="search" aria-label="Search accounts" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or college email"
          className="w-full bg-transparent py-2 text-sm normal-case tracking-normal text-white outline-none" />
      </span>
    </label>
    {error && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
    {message && <p role="status" className="text-sm text-emerald-300">{message}</p>}
    <p aria-live="polite" className="text-xs text-zinc-500">
      {search.status === 'loading' && <span className="inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Searching accounts...</span>}
      {summary}
    </p>
    {search.status === 'error' && <div role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
      Accounts could not be loaded ({search.error}). <button type="button" onClick={search.retry} className="underline">Try again</button>
    </div>}
    {search.status === 'ready' && !accounts.length && <p className="text-zinc-500">{query.trim() ? `No account matches “${query.trim()}”.` : 'No accounts yet.'}</p>}
    {accounts.length > 0 && <ul aria-label="Accounts" className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10">{accounts.map((account) => <li key={account.user_id} className="grid gap-3 bg-black/30 p-4 sm:grid-cols-[1fr_220px] sm:items-center">
      <p className="break-words font-bold text-white">{account.label}{account.user_id === currentUserId && <span className="ml-2 text-xs font-normal text-zinc-500">(you)</span>}</p>
      <select value={account.role} onChange={(event) => updateRole(account, event.target.value)} disabled={savingUserId === account.user_id} aria-label={`Role for ${account.label}`} className="rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm text-white disabled:opacity-50">
        {roleOptions.map((option) => <option key={option.value} value={option.value} disabled={account.user_id === currentUserId && option.value !== 'dictator'}>{option.label}</option>)}
      </select>
    </li>)}</ul>}
  </div>;
}
