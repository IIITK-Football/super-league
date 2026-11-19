import { useState } from 'react';
import { Link2, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useRosterPicker } from '../../hooks/useRosterPicker';
import AccountPicker from './AccountPicker';
import { inputClass, labelClass, primaryButton, ghostButton } from './adminStyles';
import { linkErrorMessage } from './PlayerAccountLink';

// Manual link, for a dictator: choose a verified account by its Auth email, then find the player through Division ->
// Season -> Team -> Player. Only players without an account are offered. The selectors only find the player: the link
// belongs to the player identity, so it applies to every roster and all history of that player.
export default function ManualLink({ onChanged }) {
  const picker = useRosterPicker();
  const [account, setAccount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const { choice } = picker;
  const eligible = picker.players.filter((p) => !p.linked);
  const chosen = eligible.find((p) => p.id === choice.playerId) || null;

  const link = async () => {
    if (!account || !chosen) return;
    setBusy(true); setError(''); setMessage('');
    const { error: err } = await supabase.rpc('link_player_account', { p_player: chosen.id, p_user: account.user_id });
    setBusy(false);
    if (err) { setError(linkErrorMessage(err)); return; }
    setMessage(`${chosen.first_name} ${chosen.last_name} is linked to ${account.email}, in every season they play.`);
    setAccount(null);
    picker.reloadPlayers();
    onChanged?.();
  };
  const select = (label, value, onChange, options, placeholder) => <label className={labelClass}>{label}
    <select aria-label={`Link ${label.toLowerCase()}`} value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} mt-1 normal-case tracking-normal`}>
      <option value="">{placeholder}</option>{options}
    </select>
  </label>;

  return <details className="rounded-2xl border border-white/10 bg-white/[.02] p-5">
    <summary className="cursor-pointer text-sm font-black uppercase tracking-wider text-zinc-300">Link an account to a player</summary>
    <div className="mt-3 space-y-3">
      <p className="text-xs text-zinc-500">1. Choose the person&apos;s verified account. 2. Find their player through the rosters. The link applies to the player in every season.</p>
      {account
        ? <p className="flex flex-wrap items-center gap-2 text-sm text-white">Account: <span className="font-bold">{account.email}</span>
          <button type="button" onClick={() => setAccount(null)} className={ghostButton}>Change</button></p>
        : <AccountPicker label="1. Verified account" idPrefix="Manual" onPick={(a) => { setAccount(a); setMessage(''); setError(''); }}
          canPick={(a) => !a.linked_player_id} />}
      {account && <div className="grid gap-3 md:grid-cols-4">
        {select('Division', choice.divisionId, picker.chooseDivision, picker.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>),
          picker.loading === 'divisions' ? 'Loading divisions...' : 'Choose a division')}
        {select('Season', choice.seasonId, picker.chooseSeason, picker.seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_current ? ' (current)' : ''}</option>),
          picker.loading === 'seasons' ? 'Loading seasons...' : !choice.divisionId ? 'Choose a division first' : 'Choose a season')}
        {select('Team', choice.entryId, picker.chooseEntry, picker.entries.map((e) => <option key={e.id} value={e.id}>{e.name}</option>),
          picker.loading === 'entries' ? 'Loading teams...' : !choice.seasonId ? 'Choose a season first' : picker.entries.length ? 'Choose a team' : 'No teams in this season')}
        {select('Player', choice.playerId, picker.choosePlayer, eligible.map((p) => <option key={p.id} value={p.id}>{p.jersey_number ?? '–'} · {p.first_name} {p.last_name}</option>),
          picker.loading === 'players' ? 'Loading players...' : !choice.entryId ? 'Choose a team first' : eligible.length ? `Choose a player without an account (${eligible.length})` : 'Every player on this team has an account')}
      </div>}
      {picker.error && <p role="alert" className="text-xs text-red-300">{picker.error}</p>}
      {account && <button type="button" onClick={link} disabled={!chosen || busy} className={primaryButton}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Link {chosen ? `${chosen.first_name} ${chosen.last_name}` : 'player'}</button>}
      {error && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      {message && <p role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">{message}</p>}
    </div>
  </details>;
}
