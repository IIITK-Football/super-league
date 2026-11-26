import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useLatestSearch } from '../../hooks/useLatestSearch';
import { Button, Field, Notice } from '../ui';

// Finds a verified account by its Auth email (at least two characters; unverified accounts are never offered) for a
// dictator, through verified_accounts_for_linking. Each result says whether the account already has a player, or
// whether an unlinked player is waiting for it (the same email): the caller decides what choosing it means.
// onPick(account): { user_id, email, linked_player_id, linked_player_name, linked_player_place, key_player_id,
// key_player_name, key_player_place }. pickLabel(account) names the action (default "Choose").
export default function AccountPicker({ label = 'Verified account', idPrefix = 'Account', onPick, pickLabel = () => 'Choose', canPick = () => true }) {
  const [query, setQuery] = useState('');
  const accounts = useLatestSearch((text) => supabase.rpc('verified_accounts_for_linking', { p_query: text }), query, { minLength: 2 });

  return <div className="space-y-3">
    <Field type="search" label={label} aria-label={`${idPrefix} email search`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Sign-in email" />
    <p aria-live="polite" className="text-sm text-mut">
      {accounts.status === 'idle' && query.trim() && 'Type at least two characters of the email.'}
      {accounts.status === 'loading' && 'Searching accounts...'}
      {accounts.status === 'ready' && !accounts.results.length && `No verified account matches “${query.trim()}”. The person must sign up and confirm their email first.`}
    </p>
    {accounts.status === 'error' && <Notice tone="error" role="alert">
      The account search failed ({accounts.error}). <Button variant="quiet" size="sm" onClick={accounts.retry}>Try again</Button>
    </Notice>}
    {accounts.status === 'ready' && accounts.results.length > 0 && <ul aria-label={`${idPrefix} matches`} className="divide-y divide-line rounded-card border border-line">{accounts.results.map((a) => (
      <li key={a.user_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
        <span className="min-w-0">
          <span className="font-semibold text-ink">{a.email}</span>
          {a.linked_player_id && <span className="block text-sm text-mut">Has a player: {a.linked_player_name}{a.linked_player_place ? ` · ${a.linked_player_place}` : ''}</span>}
          {!a.linked_player_id && a.key_player_id && <span className="block text-sm text-acc">Waiting player (same email): {a.key_player_name}{a.key_player_place ? ` · ${a.key_player_place}` : ''}</span>}
        </span>
        {canPick(a) && <Button variant="secondary" size="sm" onClick={() => { onPick(a); setQuery(''); }} aria-label={`${pickLabel(a)} ${a.email}`}>{pickLabel(a)}</Button>}
      </li>))}</ul>}
  </div>;
}
