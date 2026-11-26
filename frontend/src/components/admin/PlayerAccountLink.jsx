import { useState } from 'react';
import { Link2Off, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import AccountPicker from './AccountPicker';
import { ghostButton, labelClass } from './adminStyles';
import { useConfirm } from '../ui';

// The account of one player identity, for a dictator (Teams & Rosters). A linked player's email is their account's
// verified Auth email, shown read-only; an unlinked player has none. The dictator finds a verified account by its email
// and links it, or unlinks after confirming. The database decides every rule (dictator only, verified accounts only,
// one player per account and one account per player); this panel reports its answer. Unlinking keeps the card, roster
// places and history; only the link is cleared, and nothing links it back on its own.
// status: { linked, email, account_label } from player_link_status, or null while it loads; onChanged reloads.
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
  const confirm = useConfirm();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const name = `${player.first_name} ${player.last_name}`.trim();

  const done = (err, text) => {
    if (err) { setMessage(''); setError(linkErrorMessage(err)); return; }
    setError(''); setMessage(text); onChanged?.();
  };
  const link = async (account) => {
    setBusy('link');
    const { error: err } = await supabase.rpc('link_player_account', { p_player: player.id, p_user: account.user_id });
    setBusy('');
    done(err, `${name} is linked to ${account.email}.`);
  };
  const unlink = async () => {
    if (!(await confirm({ title: `Unlink ${name}?`, description: `${status?.email} is removed from this player. The card, roster places and history are kept; the player will have no email.`, confirmLabel: 'Unlink', tone: 'danger' }))) return;
    setBusy('unlink');
    const { error: err } = await supabase.rpc('unlink_player_account', { p_player: player.id });
    setBusy('');
    done(err, `${name} is no longer linked to an account.`);
  };

  return <div role="group" aria-label="Player account" className="space-y-2 rounded-lg border border-white/10 p-3">
    <p className={labelClass}>Account and email</p>
    {statusError ? <p role="alert" className="text-xs text-red-300">The link status could not be loaded ({statusError}).</p>
      : !status ? <p className="text-xs text-zinc-500"><Loader2 size={12} className="inline animate-spin" /> Loading the account link...</p>
        : status.linked
          ? <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-white">Linked to <span className="font-bold">{status.email}</span> <span className="text-xs text-zinc-500">(the player&apos;s email; read-only)</span></span>
            <button type="button" onClick={unlink} disabled={busy === 'unlink'} className={ghostButton}>{busy === 'unlink' ? <Loader2 size={13} className="animate-spin" /> : <Link2Off size={13} />} Unlink</button>
          </div>
          : <div className="space-y-2">
            <p className="text-sm text-zinc-400">Not linked to an account, so this player has no email{status.has_key ? ' (a matching email is waiting in Account matching)' : ''}.</p>
            <AccountPicker label="Link a verified account" idPrefix="Link" onPick={link}
              pickLabel={() => (busy === 'link' ? 'Linking...' : 'Link')} canPick={(a) => !a.linked_player_id} />
          </div>}
    {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
    {message && <p role="status" className="text-xs text-emerald-300">{message}</p>}
  </div>;
}
