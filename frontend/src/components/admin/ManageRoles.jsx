import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useLatestSearch } from '../../hooks/useLatestSearch';
import { Search, Timer, UserRound } from 'lucide-react';
import { Button, Field, Notice, Skeleton, Switch, TextInput, toast, useConfirm } from '../ui';

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
    setSavingUserId(account.user_id);
    const { error: writeError } = on
      ? await supabase.from('user_roles').insert({ user_id: account.user_id, role })
      : await supabase.from('user_roles').delete().eq('user_id', account.user_id).eq('role', role);
    if (writeError) setError(writeError.message);
    else {
      setChanged((current) => ({ ...current, [account.user_id]: on ? [...account.roles, role] : account.roles.filter((r) => r !== role) }));
      toast({ tone: 'success', title: `${on ? 'Granted' : 'Removed'} ${roleOptions.find((o) => o.value === role).label.toLowerCase()} for ${account.label}.` });
    }
    setSavingUserId('');
  };

  const summary = search.status === 'ready' && accounts.length
    ? `${accounts.length} account${accounts.length === 1 ? '' : 's'}${accounts.length === PAGE_LIMIT ? ` shown (the first ${PAGE_LIMIT}; search to narrow)` : ''}`
    : '';

  return <div className="space-y-6">
    <Field label="Search accounts">{(p) => <TextInput {...p} icon={Search} type="search" size="lg" aria-label="Search accounts" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or college email" />}</Field>
    {error && <Notice tone="error" role="alert">{error}</Notice>}
    <p aria-live="polite" className="eyebrow">{search.status === 'loading' ? 'Searching accounts...' : summary}</p>
    {search.status === 'loading' && !accounts.length && <Skeleton className="h-40 w-full rounded-card" />}
    {search.status === 'error' && <Notice tone="error" role="alert">
      Accounts could not be loaded ({search.error}). <Button variant="quiet" size="sm" onClick={search.retry}>Try again</Button>
    </Notice>}
    {search.status === 'ready' && !accounts.length && <div className="flex flex-col items-start gap-2 rounded-card border border-dashed border-line p-6 text-sm text-mut">
      <UserRound size={26} aria-hidden="true" />
      {query.trim() ? `No account matches “${query.trim()}”.` : 'No accounts yet.'}
    </div>}
    {accounts.length > 0 && <ul aria-label="Accounts" className="glass divide-y divide-line/70 rounded-card px-2">{accounts.map((account) => <li key={account.user_id} className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink/[0.08] font-display text-sm text-ink">{account.label.trim()[0]?.toUpperCase()}</span>
        <div className="min-w-0">
          <p className="break-words font-semibold text-ink">{account.label}{account.user_id === currentUserId && <span className="ml-2 text-sm font-normal text-mut">(you)</span>}</p>
          {roleOptions.filter((o) => o.assignment && account.roles.includes(o.value) && !assignments[o.assignment][account.user_id]).map((o) =>
            <p key={o.value} className="text-sm text-mut">{o.label} role without an assignment: it cannot act until a dictator assigns a team.</p>)}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pl-13 lg:pl-0">
        <fieldset disabled={savingUserId === account.user_id} className="flex flex-wrap gap-x-5 gap-y-1">
          <legend className="sr-only">Roles for {account.label}</legend>
          {roleOptions.map((option) => <span key={option.value} className="flex min-h-11 items-center gap-2 text-sm font-semibold text-ink">
            <Switch checked={account.roles.includes(option.value)} aria-label={`${option.label} for ${account.label}`} disabled={savingUserId === account.user_id}
              onChange={(on) => toggle(account, option.value, on)} />
            {option.label}
          </span>)}
        </fieldset>
        <Button variant="secondary" size="sm" onClick={() => onAssignScorer?.(account)}>
          <Timer size={15} aria-hidden="true" />{account.roles.includes('scorer') ? 'Scorer assignments' : 'Assign as scorer'}
        </Button>
      </div>
    </li>)}</ul>}
  </div>;
}
