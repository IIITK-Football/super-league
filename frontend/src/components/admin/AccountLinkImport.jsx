import { useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { parseLinkCsv } from '../../lib/parseLinkCsv';
import { ghostButton, inputClass, primaryButton } from './adminStyles';
import { linkErrorMessage } from './PlayerAccountLink';

// The account-link import, for a dictator: paste a CSV (`player_id,email`), preview what each row would do, then apply.
// The preview never writes. Apply is offered only after a preview of exactly this text with no problem rows, and the
// database recomputes the preview and changes nothing if any row has a problem. Emails match verified accounts only;
// nothing is matched by name. A blank email uses the player's dictator-entered contact email.
export const LINK_STATUS = {
  ready: 'Will be linked',
  already_linked: 'Already linked (nothing to do)',
  invalid_row: 'Not a valid player id',
  unknown_player: 'No such player',
  missing_email: 'No email, and the player has no contact email',
  duplicate_player_in_file: 'This player appears more than once in the file',
  duplicate_account_in_file: 'This email appears more than once in the file',
  no_account: 'No account has this email',
  unverified_account: 'The account has not confirmed its email',
  player_linked_elsewhere: 'The player is linked to another account',
  account_linked_elsewhere: 'The account is linked to another player',
};
const OK = new Set(['ready', 'already_linked']);

export default function AccountLinkImport({ onApplied }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(null); // { text, rows }
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const parsed = parseLinkCsv(text);
  const fresh = preview && preview.text === text;
  const problems = fresh ? preview.rows.filter((r) => !OK.has(r.status)).length : 0;
  const ready = fresh ? preview.rows.filter((r) => r.status === 'ready').length : 0;

  const runPreview = async () => {
    setMessage(''); setError('');
    if (parsed.error) { setError(parsed.error); setPreview(null); return; }
    setBusy('preview');
    const { data, error: err } = await supabase.rpc('preview_player_account_links', { p_rows: parsed.rows });
    setBusy('');
    if (err) { setError(linkErrorMessage(err)); setPreview(null); return; }
    setPreview({ text, rows: data || [] });
  };
  const apply = async () => {
    setBusy('apply');
    const { data, error: err } = await supabase.rpc('apply_player_account_links', { p_rows: parsed.rows });
    setBusy('');
    if (err) { setMessage(''); setError(`${linkErrorMessage(err)} Nothing was linked.`); setPreview(null); return; }
    setError(''); setMessage(`${data} player${data === 1 ? '' : 's'} linked.`); setPreview(null); setText('');
    onApplied?.();
  };

  return <details className="rounded-2xl border border-white/10 bg-white/[.02] p-5">
    <summary className="cursor-pointer text-sm font-black uppercase tracking-wider text-zinc-300">Import account links</summary>
    <div className="mt-3 space-y-3">
      <p className="text-xs text-zinc-500">One line per player: <code>player_id,email</code> under that header. Leave the email blank to use the player&apos;s contact email. Only verified accounts are linked, never by name; preview first, nothing is written until you apply a clean preview.</p>
      <textarea aria-label="Account links file" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={'player_id,email\n8c1f...,name@iiitkottayam.ac.in'} className={`${inputClass} font-mono`} />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={runPreview} disabled={busy === 'preview' || !text.trim()} className={ghostButton}>{busy === 'preview' ? <Loader2 size={13} className="animate-spin" /> : null} Preview</button>
        <button type="button" onClick={apply} disabled={!fresh || problems > 0 || ready === 0 || busy === 'apply'} className={primaryButton}>{busy === 'apply' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Apply {fresh && ready ? `(${ready})` : ''}</button>
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      {message && <p role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">{message}</p>}
      {preview && !fresh && <p className="text-xs text-amber-300">The file changed since the preview. Preview again to apply.</p>}
      {fresh && <>
        <p aria-live="polite" className="text-sm text-zinc-300">{preview.rows.length} rows: {ready} to link, {preview.rows.length - ready - problems} already linked, {problems} need attention.{problems > 0 && ' Fix them in the file and preview again; nothing is linked while any row needs attention.'}</p>
        <table aria-label="Account links preview" className="w-full text-left text-xs">
          <thead><tr className="text-zinc-500"><th className="p-1">Line</th><th className="p-1">Player</th><th className="p-1">Email</th><th className="p-1">Result</th></tr></thead>
          <tbody>{preview.rows.map((r) => <tr key={r.n} className={OK.has(r.status) ? 'text-zinc-300' : 'text-red-300'}>
            <td className="p-1">{r.n + 1}</td><td className="p-1 font-mono">{r.player_id || parsed.rows[r.n - 1]?.player_id}</td>
            <td className="p-1">{r.account_label || r.email || '—'}</td><td className="p-1">{LINK_STATUS[r.status] || r.status}</td>
          </tr>)}</tbody>
        </table>
      </>}
    </div>
  </details>;
}
