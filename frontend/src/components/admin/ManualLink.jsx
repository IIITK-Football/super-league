import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useRosterPicker } from '../../hooks/useRosterPicker';
import AccountPicker from './AccountPicker';
import { Button, Card, Field, Notice } from '../ui';
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
  const select = (label, value, onChange, options, placeholder) => <Field as="select" label={label} aria-label={`Link ${label.toLowerCase()}`} value={value} onChange={(e) => onChange(e.target.value)}>
    <option value="">{placeholder}</option>{options}
  </Field>;

  return <details className="group rounded-card border border-line bg-surf p-4">
    <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-ink">Link an account to a player</summary>
    <div className="mt-4 space-y-4">
      <p className="text-sm text-mut">1. Choose the person&apos;s verified account. 2. Find their player through the rosters. The link applies to the player in every season.</p>
      {account
        ? <p className="flex flex-wrap items-center gap-2 text-ink">Account: <span className="font-semibold">{account.email}</span>
          <Button variant="quiet" size="sm" onClick={() => setAccount(null)}>Change</Button></p>
        : <AccountPicker label="1. Verified account" idPrefix="Manual" onPick={(a) => { setAccount(a); setMessage(''); setError(''); }}
          canPick={(a) => !a.linked_player_id} />}
      {account && <Card className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-4">
        {select('Division', choice.divisionId, picker.chooseDivision, picker.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>),
          picker.loading === 'divisions' ? 'Loading divisions...' : 'Choose a division')}
        {select('Season', choice.seasonId, picker.chooseSeason, picker.seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_current ? ' (current)' : ''}</option>),
          picker.loading === 'seasons' ? 'Loading seasons...' : !choice.divisionId ? 'Choose a division first' : 'Choose a season')}
        {select('Team', choice.entryId, picker.chooseEntry, picker.entries.map((e) => <option key={e.id} value={e.id}>{e.name}</option>),
          picker.loading === 'entries' ? 'Loading teams...' : !choice.seasonId ? 'Choose a season first' : picker.entries.length ? 'Choose a team' : 'No teams in this season')}
        {select('Player', choice.playerId, picker.choosePlayer, eligible.map((p) => <option key={p.id} value={p.id}>{p.jersey_number ?? '-'} · {p.first_name} {p.last_name}</option>),
          picker.loading === 'players' ? 'Loading players...' : !choice.entryId ? 'Choose a team first' : eligible.length ? `Choose a player without an account (${eligible.length})` : 'Every player on this team has an account')}
      </Card>}
      {picker.error && <Notice tone="error" role="alert">{picker.error}</Notice>}
      {account && <Button onClick={link} disabled={!chosen || busy}>{busy ? 'Linking...' : `Link ${chosen ? `${chosen.first_name} ${chosen.last_name}` : 'player'}`}</Button>}
      {error && <Notice tone="error" role="alert">{error}</Notice>}
      {message && <Notice tone="success" role="status">{message}</Notice>}
    </div>
  </details>;
}
