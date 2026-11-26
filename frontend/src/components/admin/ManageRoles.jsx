import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useLatestSearch } from '../../hooks/useLatestSearch';
import { Button, Field, Notice, useConfirm } from '../ui';

// Roles are independent grants: no role implies another and a normal user holds none. A captain grant only acts together
// with a team assignment, made under Teams & Rosters; the hint below each account says when it has none. A scorer is
// granted only through an assignment in Scorers, so the one scorer flow lives there.
const roleOptions = [
  { value: 'captain', label: 'Captain', assignment: 'captain' },
  { value: 'editor', label: 'Editor' },
  { value: 'dictator', label: 'Dictator' },
];
export const PAGE_LIMIT = 50;

const countBy = (rows) => (rows ?? []).reduce((acc, r) => ({ ...acc, [r.user_id]: (acc[r.user_id] ?? 0) + 1 }), {});

// Access control. Accounts come from the dictator-only account directory: each is labelled by the verified sign-in
// email from Supabase Auth with the profile name as context, never by the self-editable profile email or a raw id.
// Searching matches every word of the name or email; grants are written to user_roles (row level security decides).
export default function ManageRoles({ currentUserId, onAssignScorer }) { // eslint-disable-line react/prop-types
  const [query, setQuery] = useState('');
  const [changed, setChanged] = useState({});
  const [savingUserId, setSavingUserId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [assignments, setAssignments] = useState({ captain: {}, scorer: {} });
  const confirm = useConfirm();
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
    // A dictator manages everything, so granting or removing it names the person and asks first.
    if (role === 'dictator') {
      const ok = await confirm({
        title: on ? 'Make this account a dictator?' : 'Remove dictator access?',
        description: on ? `${account.label} can manage every division, season, team, player, match and role.` : `${account.label} loses dictator access and every setting it can change.`,
        confirmLabel: on ? 'Make dictator' : 'Remove dictator',
        tone: on ? 'default' : 'danger',
      });
      if (!ok) return;
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

  return <div className="space-y-6">
    <div className="space-y-1">
      <h2 className="font-display text-2xl font-bold text-ink">Access control</h2>
      <p className="text-sm text-mut">Find an account by name or college email, then grant or remove roles. Roles are independent; a captain or scorer also needs an assignment.</p>
    </div>
    <Field type="search" label="Search accounts" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or college email" />
    {error && <Notice tone="error" role="alert">{error}</Notice>}
    {message && <Notice tone="success" role="status">{message}</Notice>}
    <p aria-live="polite" className="text-sm text-mut">{search.status === 'loading' ? 'Searching accounts...' : summary}</p>
    {search.status === 'error' && <Notice tone="error" role="alert">
      Accounts could not be loaded ({search.error}). <Button variant="quiet" size="sm" onClick={search.retry}>Try again</Button>
    </Notice>}
    {search.status === 'ready' && !accounts.length && <p className="text-sm text-mut">{query.trim() ? `No account matches “${query.trim()}”.` : 'No accounts yet.'}</p>}
    {accounts.length > 0 && <ul aria-label="Accounts" className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surf">{accounts.map((account) => <li key={account.user_id} className="space-y-3 p-4">
      <p className="break-words font-semibold text-ink">{account.label}{account.user_id === currentUserId && <span className="ml-2 text-sm font-normal text-mut">(you)</span>}</p>
      <fieldset disabled={savingUserId === account.user_id} className="flex flex-wrap gap-x-6 gap-y-2">
        <legend className="sr-only">Roles for {account.label}</legend>
        {roleOptions.map((option) => <label key={option.value} className="flex min-h-11 items-center gap-2 text-ink">
          <input type="checkbox" className="size-5 accent-acc" checked={account.roles.includes(option.value)} aria-label={`${option.label} for ${account.label}`}
            onChange={(event) => toggle(account, option.value, event.target.checked)} />
          {option.label}
        </label>)}
      </fieldset>
      {roleOptions.filter((o) => o.assignment && account.roles.includes(o.value) && !assignments[o.assignment][account.user_id]).map((o) =>
        <p key={o.value} className="text-sm text-acc">{o.label} role without an assignment: it cannot act until a dictator assigns a team.</p>)}
      <Button variant="quiet" size="sm" onClick={() => onAssignScorer?.(account)}>
        {account.roles.includes('scorer') ? 'Scorer assignments' : 'Assign as scorer'}
      </Button>
    </li>)}</ul>}
  </div>;
}
