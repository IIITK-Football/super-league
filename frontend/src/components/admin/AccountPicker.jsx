import { useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useLatestSearch } from '../../hooks/useLatestSearch';
import { ghostButton, labelClass } from './adminStyles';

// Finds a verified account by its Auth email (at least two characters; unverified accounts are never offered) for a
// dictator, through verified_accounts_for_linking. Each result says whether the account already has a player, or
// whether an unlinked player is waiting for it (the same email): the caller decides what choosing it means.
// onPick(account): { user_id, email, linked_player_id, linked_player_name, linked_player_place, key_player_id,
// key_player_name, key_player_place }. pickLabel(account) names the action (default "Choose").
export default function AccountPicker({ label = 'Verified account', idPrefix = 'Account', onPick, pickLabel = () => 'Choose', canPick = () => true }) {
  const [query, setQuery] = useState('');
  const accounts = useLatestSearch((text) => supabase.rpc('verified_accounts_for_linking', { p_query: text }), query, { minLength: 2 });

  return <div className="space-y-2">
    <label className={`${labelClass} block`}>{label}
      <span className="mt-1 flex items-center gap-2 rounded-lg border border-white/10 bg-black/50 px-3 focus-within:border-[#d9ff4a]/60">
        <Search size={14} className="text-zinc-500" aria-hidden="true" />
        <input type="search" aria-label={`${idPrefix} email search`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Sign-in email"
          className="w-full bg-transparent py-2 text-sm normal-case tracking-normal text-white outline-none" />
      </span>
    </label>
    <p aria-live="polite" className="text-xs text-zinc-500">
      {accounts.status === 'idle' && query.trim() && 'Type at least two characters of the email.'}
      {accounts.status === 'loading' && <span className="inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Searching accounts...</span>}
      {accounts.status === 'ready' && !accounts.results.length && `No verified account matches “${query.trim()}”. The person must sign up and confirm their email first.`}
    </p>
    {accounts.status === 'error' && <p role="alert" className="text-xs text-red-300">
      The account search failed ({accounts.error}). <button type="button" onClick={accounts.retry} className="underline">Try again</button>
    </p>}
    {accounts.status === 'ready' && accounts.results.length > 0 && <ul aria-label={`${idPrefix} matches`} className="space-y-1">{accounts.results.map((a) => (
      <li key={a.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/5 bg-black/30 px-3 py-2 text-sm">
        <span><span className="text-white">{a.email}</span>
          {a.linked_player_id && <span className="block text-xs text-zinc-500">Has a player: {a.linked_player_name}{a.linked_player_place ? ` · ${a.linked_player_place}` : ''}</span>}
          {!a.linked_player_id && a.key_player_id && <span className="block text-xs text-amber-300">Waiting player (same email): {a.key_player_name}{a.key_player_place ? ` · ${a.key_player_place}` : ''}</span>}
        </span>
        {canPick(a) && <button type="button" onClick={() => { onPick(a); setQuery(''); }} aria-label={`${pickLabel(a)} ${a.email}`} className={ghostButton}>{pickLabel(a)}</button>}
      </li>))}</ul>}
  </div>;
}
