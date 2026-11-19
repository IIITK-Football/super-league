import { useState } from 'react';
import { Link2, Link2Off, Loader2, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useLatestSearch } from '../../hooks/useLatestSearch';
import { ghostButton, labelClass } from './adminStyles';

// The account link of one player identity, for a dictator (Teams & Rosters). Shows which verified account the player is
// linked to, or lets the dictator find a verified account by name or email and link it, or unlink. The database decides
// every rule (dictator only, verified accounts only, one player per account and one account per player); this panel
// reports its answer. Unlinking keeps the card, roster places and history; only the link is cleared.
// status: { linked, account_label } from player_link_status, or null while it loads; onChanged reloads the roster.
export const linkErrorMessage = (error) => {
  if (!error) return '';
  if (error.code === '42501') return 'Only a dictator can link or unlink player accounts.';
  if (error.code === '23514') return 'Only a verified account can be linked. The person must confirm their email first.';
  if (error.code === '23505') return error.message?.startsWith('This player')
    ? 'This player is already linked to another account. Unlink it first.'
    : 'That account is already linked to another player.';
  return error.message || 'The change could not be saved.';
};

export default function PlayerAccountLink({ player, status, statusError, onChanged }) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const name = `${player.first_name} ${player.last_name}`.trim();
  const accounts = useLatestSearch((text) => supabase.rpc('player_link_candidates', { p_query: text }), query, { minLength: 2, deps: [player.id] });

  const done = (err, text) => {
    if (err) { setMessage(''); setError(linkErrorMessage(err)); return; }
    setError(''); setMessage(text); setQuery(''); onChanged?.();
  };
  const link = async (account) => {
    setBusy(`link-${account.user_id}`);
    const { error: err } = await supabase.rpc('link_player_account', { p_player: player.id, p_user: account.user_id });
    setBusy('');
    done(err, `${name} is linked to ${account.label}.`);
  };
  const unlink = async () => {
    if (!window.confirm(`Unlink ${name} from ${status?.account_label}? The card, roster places and history are kept.`)) return;
    setBusy('unlink');
    const { error: err } = await supabase.rpc('unlink_player_account', { p_player: player.id });
    setBusy('');
    done(err, `${name} is no longer linked to an account.`);
  };

  return <div role="group" aria-label="Player account" className="space-y-2 rounded-lg border border-white/10 p-3">
    <p className={labelClass}>Account</p>
    {statusError ? <p role="alert" className="text-xs text-red-300">The link status could not be loaded ({statusError}).</p>
      : !status ? <p className="text-xs text-zinc-500"><Loader2 size={12} className="inline animate-spin" /> Loading the account link...</p>
        : status.linked
          ? <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-white">Linked to <span className="font-bold">{status.account_label}</span></span>
            <button type="button" onClick={unlink} disabled={busy === 'unlink'} className={ghostButton}>{busy === 'unlink' ? <Loader2 size={13} className="animate-spin" /> : <Link2Off size={13} />} Unlink</button>
          </div>
          : <div className="space-y-2">
            <p className="text-sm text-zinc-400">Not linked to an account.</p>
            <label className={`${labelClass} block`}>Link a verified account
              <span className="mt-1 flex items-center gap-2 rounded-lg border border-white/10 bg-black/50 px-3 focus-within:border-[#d9ff4a]/60">
                <Search size={14} className="text-zinc-500" aria-hidden="true" />
                <input type="search" aria-label="Search accounts" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or email"
                  className="w-full bg-transparent py-2 text-sm normal-case tracking-normal text-white outline-none" />
              </span>
            </label>
            <p aria-live="polite" className="text-xs text-zinc-500">
              {accounts.status === 'idle' && query.trim() && 'Type at least two letters of the name or email.'}
              {accounts.status === 'loading' && <span className="inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Searching accounts...</span>}
              {accounts.status === 'ready' && !accounts.results.length && `No verified account matches “${query.trim()}”. Only accounts with a confirmed email can be linked.`}
            </p>
            {accounts.status === 'error' && <p role="alert" className="text-xs text-red-300">
              The account search failed ({accounts.error}). <button type="button" onClick={accounts.retry} className="underline">Try again</button>
            </p>}
            {accounts.status === 'ready' && accounts.results.length > 0 && <ul aria-label="Matching accounts" className="space-y-1">{accounts.results.map((a) => (
              <li key={a.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/5 bg-black/30 px-3 py-2 text-sm">
                <span className="text-white">{a.label}</span>
                {a.linked_player_id
                  ? <span className="text-xs text-zinc-500">Already linked to {a.linked_player_name || 'another player'}</span>
                  : <button type="button" onClick={() => link(a)} disabled={busy === `link-${a.user_id}`} aria-label={`Link ${a.label}`} className={ghostButton}>
                    {busy === `link-${a.user_id}` ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />} Link</button>}
              </li>))}</ul>}
          </div>}
    {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
    {message && <p role="status" className="text-xs text-emerald-300">{message}</p>}
  </div>;
}
