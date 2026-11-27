import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { linkErrorMessage } from './PlayerAccountLink';
import { Button, Card, Notice, Pill, Table, useConfirm } from '../ui';

// Account matching, for a dictator: legacy players without an account are matched to verified accounts by exact email
// (never by name). The preview is live (account_link_matches); "Link all ready matches" sends exactly the ready pairs
// shown, and the database links only those still ready, skipping and reporting anything that changed. Duplicates,
// conflicts and unverified accounts stay unlinked for manual resolution; a key can be dismissed.
export const MATCH_STATUS = {
  ready: { label: 'Ready to link', help: 'Exactly one waiting player and one verified account share this email.' },
  waiting_verification: { label: 'Waiting for verification', help: 'The account exists but has not confirmed its email; it links on its own once confirmed.' },
  no_account: { label: 'No account yet', help: 'Nobody has signed up with this email; it links on its own when they do and confirm it.' },
  duplicate: { label: 'Duplicate', help: 'Several waiting players share this email. Link the right one by hand.' },
  conflict: { label: 'Conflict', help: 'The account with this email is already linked to another player. Resolve it by hand.' },
};
const ORDER = ['ready', 'duplicate', 'conflict', 'waiting_verification', 'no_account'];

export default function AccountMatches({ onChanged }) {
  const confirm = useConfirm();
  const [state, setState] = useState({ status: 'loading', rows: [], error: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading', error: '' }));
    const { data, error: err } = await supabase.rpc('account_link_matches');
    if (err) { setState({ status: 'error', rows: [], error: linkErrorMessage(err) }); return; }
    setState({ status: 'ready', rows: data || [], error: '' });
  }, []);
  useEffect(() => { load(); }, [load]);

  const counts = Object.fromEntries(ORDER.map((k) => [k, state.rows.filter((r) => r.status === k).length]));
  const ready = state.rows.filter((r) => r.status === 'ready');

  const applyAll = async () => {
    if (!(await confirm({ title: `Link ${ready.length} player${ready.length === 1 ? '' : 's'}?`, description: 'Each player is linked to their verified account.', confirmLabel: 'Link players' }))) return;
    setBusy('apply'); setError(''); setMessage('');
    const { data, error: err } = await supabase.rpc('apply_account_link_matches', { p_expected: ready.map(({ player_id, user_id }) => ({ player_id, user_id })) });
    setBusy('');
    if (err) { setError(`${linkErrorMessage(err)} Nothing was linked.`); return; }
    const skipped = data?.skipped?.length || 0;
    setMessage(`${data?.linked ?? 0} player${data?.linked === 1 ? '' : 's'} linked.${skipped ? ` ${skipped} changed since the preview and ${skipped === 1 ? 'was' : 'were'} skipped.` : ''}`);
    await load();
    onChanged?.();
  };
  const dismiss = async (row) => {
    if (!(await confirm({ title: 'Dismiss the waiting email?', description: `${row.player_name} stays as is, without an account. You can still link them by hand.`, confirmLabel: 'Dismiss', tone: 'danger' }))) return;
    setBusy(`dismiss-${row.player_id}`); setError(''); setMessage('');
    const { error: err } = await supabase.rpc('dismiss_player_link_key', { p_player: row.player_id });
    setBusy('');
    if (err) { setError(linkErrorMessage(err)); return; }
    setMessage(`The waiting email of ${row.player_name} was dismissed.`);
    load();
  };

  return <Card as="details" open className="space-y-4 p-4">
    <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-ink">Account matching</summary>
    <div className="space-y-4">
      <p className="text-sm text-mut">Players from before accounts were required are matched to verified accounts by their exact email, never by name. Anything not ready stays unlinked for you to resolve.</p>
      {state.status === 'loading' && <p className="text-sm text-mut">Loading matches...</p>}
      {state.status === 'error' && <Notice tone="error" role="alert">The matches could not be loaded ({state.error}). <Button variant="quiet" size="sm" onClick={load}>Try again</Button></Notice>}
      {state.status === 'ready' && !state.rows.length && <p className="text-sm text-mut">No players are waiting for an account.</p>}
      {state.status === 'ready' && state.rows.length > 0 && <>
        <ul aria-label="Match counts" className="flex flex-wrap gap-2">
          {ORDER.map((k) => <li key={k}><Pill>{MATCH_STATUS[k].label}: <span className="font-display text-sm tabular-nums text-ink">{counts[k]}</span></Pill></li>)}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button onClick={applyAll} disabled={!ready.length || busy === 'apply'}>{busy === 'apply' ? 'Linking...' : `Link all ${ready.length} ready match${ready.length === 1 ? '' : 'es'}`}</Button>
          <Button variant="secondary" onClick={load}>Refresh</Button>
        </div>
        <Table caption="Account matches">
          <thead><tr><th scope="col">Player</th><th scope="col">Email</th><th scope="col">Result</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{[...state.rows].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status)).map((r) => <tr key={r.player_id}>
            <td>{r.player_name}{r.player_place && <span className="block text-sm text-mut">{r.player_place}</span>}</td>
            <td className="text-mut">{r.email}</td>
            <td><span title={MATCH_STATUS[r.status]?.help} className={r.status === 'ready' ? 'font-semibold text-acc2' : 'text-mut'}>{MATCH_STATUS[r.status]?.label || r.status}</span></td>
            <td className="text-right">{r.status !== 'ready' && <Button variant="quiet" size="sm" onClick={() => dismiss(r)} disabled={busy === `dismiss-${r.player_id}`} aria-label={`Dismiss ${r.player_name}`}>Dismiss</Button>}</td>
          </tr>)}</tbody>
        </Table>
      </>}
      {error && <Notice tone="error" role="alert">{error}</Notice>}
      {message && <Notice tone="success" role="status">{message}</Notice>}
    </div>
  </Card>;
}
