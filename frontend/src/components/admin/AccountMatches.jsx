import { useCallback, useEffect, useState } from 'react';
import { Link2, Loader2, RefreshCw, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { ghostButton, primaryButton } from './adminStyles';
import { linkErrorMessage } from './PlayerAccountLink';
import { useConfirm } from '../ui';

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

  return <details className="rounded-2xl border border-white/10 bg-white/[.02] p-5" open>
    <summary className="cursor-pointer text-sm font-black uppercase tracking-wider text-zinc-300">Account matching</summary>
    <div className="mt-3 space-y-3">
      <p className="text-xs text-zinc-500">Players from before accounts were required are matched to verified accounts by their exact email, never by name. Anything not ready stays unlinked for you to resolve.</p>
      {state.status === 'loading' && <p className="text-sm text-zinc-500"><Loader2 size={13} className="inline animate-spin" /> Loading matches...</p>}
      {state.status === 'error' && <p role="alert" className="text-sm text-red-300">The matches could not be loaded ({state.error}). <button type="button" onClick={load} className="underline">Try again</button></p>}
      {state.status === 'ready' && !state.rows.length && <p className="text-sm text-zinc-500">No players are waiting for an account.</p>}
      {state.status === 'ready' && state.rows.length > 0 && <>
        <ul aria-label="Match counts" className="flex flex-wrap gap-2 text-xs">
          {ORDER.map((k) => <li key={k} className="rounded-full border border-white/10 px-3 py-1 text-zinc-300">{MATCH_STATUS[k].label}: <span className="font-bold text-white">{counts[k]}</span></li>)}
        </ul>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={applyAll} disabled={!ready.length || busy === 'apply'} className={primaryButton}>
            {busy === 'apply' ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Link all {ready.length} ready match{ready.length === 1 ? '' : 'es'}
          </button>
          <button type="button" onClick={load} className={ghostButton}><RefreshCw size={13} /> Refresh</button>
        </div>
        <table aria-label="Account matches" className="w-full text-left text-xs">
          <thead><tr className="text-zinc-500"><th className="p-1">Player</th><th className="p-1">Email</th><th className="p-1">Result</th><th className="p-1"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{[...state.rows].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status)).map((r) => <tr key={r.player_id} className={r.status === 'ready' ? 'text-emerald-200' : 'text-zinc-300'}>
            <td className="p-1">{r.player_name}{r.player_place && <span className="block text-zinc-500">{r.player_place}</span>}</td>
            <td className="p-1">{r.email}</td>
            <td className="p-1" title={MATCH_STATUS[r.status]?.help}>{MATCH_STATUS[r.status]?.label || r.status}</td>
            <td className="p-1">{r.status !== 'ready' && <button type="button" onClick={() => dismiss(r)} disabled={busy === `dismiss-${r.player_id}`} aria-label={`Dismiss ${r.player_name}`} className={ghostButton}><X size={12} /> Dismiss</button>}</td>
          </tr>)}</tbody>
        </table>
      </>}
      {error && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      {message && <p role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">{message}</p>}
    </div>
  </details>;
}
