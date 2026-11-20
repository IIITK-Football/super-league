import { useEffect, useState } from 'react';
import { Loader2, Search, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useLatestSearch } from '../../hooks/useLatestSearch';

// Roles are independent grants: no role implies another and a normal user holds none. A captain or scorer grant only
// acts together with an assignment (a team entry, or a season or match), which the dictator makes under Teams & Rosters
// and Scorers; the hint below each account says when a grant has none.
const roleOptions = [
  { value: 'captain', label: 'Captain', assignment: 'captain' },
  { value: 'scorer', label: 'Scorer', assignment: 'scorer' },
  { value: 'editor', label: 'Editor' },
  { value: 'dictator', label: 'Dictator' },
];
export const PAGE_LIMIT = 50;

const countBy = (rows) => (rows ?? []).reduce((acc, r) => ({ ...acc, [r.user_id]: (acc[r.user_id] ?? 0) + 1 }), {});

// Access control. Accounts come from the dictator-only account directory: each is labelled by the verified sign-in
// email from Supabase Auth with the profile name as context, never by the self-editable profile email or a raw id.
// Searching matches every word of the name or email; grants are written to user_roles (row level security decides).
export default function ManageRoles({ currentUserId }) { // eslint-disable-line react/prop-types
  const [query, setQuery] = useState('');
  const [changed, setChanged] = useState({});
  const [savingUserId, setSavingUserId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [assignments, setAssignments] = useState({ captain: {}, scorer: {} });
  const search = useLatestSearch(
    (text) => supabase.rpc('account_directory', { p_query: text || null, p_limit: PAGE_LIMIT }),
    query,
  );
  const accounts = search.results.map((a) => ({ ...a, roles: changed[a.user_id] ?? a.roles ?? [] }));

  // Assignment counts per person, to say when a captain or scorer grant has nothing to act on.
  useEffect(() => {
    let live = true;
    Promise.all([supabase.from('captain_assignments').select('user_id'), supabase.from('scorer_assignments').select('user_id')])
      .then(([captain, scorer]) => { if (live) setAssignments({ captain: countBy(captain.data), scorer: countBy(scorer.data) }); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const toggle = async (account, role, on) => {
    if (account.user_id === currentUserId && role === 'dictator' && !on) {
      setError('You cannot remove your own dictator access here.');
      return;
    }
    setError('');
    setMessage('');
    setSavingUserId(account.user_id);
    const { error: writeError } = on
      ? await supabase.from('user_roles').insert({ user_id: account.user_id, role })
      : await supabase.from('user_roles').delete().eq('user_id', account.user_id).eq('role', role);
    if (writeError) setError(writeError.message);
    else {
      setChanged((current) => ({ ...current, [account.user_id]: on ? [...account.roles, role] : account.roles.filter((r) => r !== role) }));
      setMessage(`${on ? 'Granted' : 'Removed'} ${roleOptions.find((o) => o.value === role).label.toLowerCase()} for ${account.label}.`);
    }
    setSavingUserId('');
  };

  const summary = search.status === 'ready' && accounts.length
    ? `${accounts.length} account${accounts.length === 1 ? '' : 's'}${accounts.length === PAGE_LIMIT ? ` shown (the first ${PAGE_LIMIT}; search to narrow)` : ''}`
    : '';

  return <div className="space-y-6 p-6">
    <div><h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-tight"><ShieldCheck size={21} /> Access control</h2><p className="mt-1 text-xs uppercase tracking-widest text-zinc-500">Find an account by name or college email, then grant or remove roles. Roles are independent; a captain or scorer also needs an assignment.</p></div>
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
    {accounts.length > 0 && <ul aria-label="Accounts" className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10">{accounts.map((account) => <li key={account.user_id} className="space-y-2 bg-black/30 p-4">
      <p className="break-words font-bold text-white">{account.label}{account.user_id === currentUserId && <span className="ml-2 text-xs font-normal text-zinc-500">(you)</span>}</p>
      <fieldset disabled={savingUserId === account.user_id} className="flex flex-wrap gap-x-5 gap-y-2">
        <legend className="sr-only">Roles for {account.label}</legend>
        {roleOptions.map((option) => <label key={option.value} className="flex items-center gap-2 text-sm text-zinc-200">
          <input type="checkbox" checked={account.roles.includes(option.value)} aria-label={`${option.label} for ${account.label}`}
            onChange={(event) => toggle(account, option.value, event.target.checked)} />
          {option.label}
        </label>)}
      </fieldset>
      {roleOptions.filter((o) => o.assignment && account.roles.includes(o.value) && !assignments[o.assignment][account.user_id]).map((o) =>
        <p key={o.value} className="text-xs text-amber-300">{o.label} role without an assignment: it cannot act until a dictator assigns {o.value === 'captain' ? 'a team' : 'a season or match'}.</p>)}
    </li>)}</ul>}
  </div>;
}
