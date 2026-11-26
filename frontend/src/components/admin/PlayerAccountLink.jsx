import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import AccountPicker from './AccountPicker';
import { Button, Notice, useConfirm } from '../ui';

// The account of one player identity, for a dictator (Teams and rosters). A linked player's email is their account's
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

  return <div role="group" aria-label="Player account" className="space-y-4">
    {statusError ? <Notice tone="error" role="alert">The link status could not be loaded ({statusError}).</Notice>
      : !status ? <p className="text-sm text-mut">Loading the account link...</p>
        : status.linked
          ? <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-ink">Linked to <span className="font-semibold">{status.email}</span> <span className="text-sm text-mut">(the account&apos;s email, read-only)</span></p>
            <Button variant="secondary" size="sm" onClick={unlink} disabled={busy === 'unlink'}>{busy === 'unlink' ? 'Unlinking...' : 'Unlink'}</Button>
          </div>
          : <div className="space-y-3">
            <p className="text-sm text-mut">Not linked to an account, so this player has no email{status.has_key ? '. A matching email is waiting in Account matching' : ''}.</p>
            <AccountPicker label="Link a verified account" idPrefix="Link" onPick={link}
              pickLabel={() => (busy === 'link' ? 'Linking...' : 'Link')} canPick={(a) => !a.linked_player_id} />
          </div>}
    {error && <Notice tone="error" role="alert">{error}</Notice>}
    {message && <Notice tone="success" role="status">{message}</Notice>}
  </div>;
}
