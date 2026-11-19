import { useCallback, useEffect, useState } from 'react';
import { ImagePlus, Loader2, Save } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { API_BASE_URL } from '../../lib/api';
import { FEET } from '../../lib/playerCard';
import FutCard from './FutCard';

// "Your player card" on /profile: the player identity a dictator linked to the signed-in account (my_player). The
// player changes only their portrait and preferred foot (update_my_player); name, rating, stats and play style are
// shown but set by captains and dictators. A new portrait uploads to the player's own key, then goes live when saved,
// and every change is recorded in the audit history. Unlinked accounts see how to get linked.
const footOf = (player) => player?.attributes?.bio?.preferredFoot || '';

async function uploadOwnPortrait(file) {
  const form = new FormData();
  form.append('image', file, 'portrait.png');
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch(`${API_BASE_URL}/profile/player-portrait`, {
    method: 'POST', credentials: 'include', headers: { Authorization: `Bearer ${session?.access_token}` }, body: form,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.imageUrl) throw new Error(result.message || result.error || `the upload was refused (HTTP ${response.status})`);
  return result.imageUrl;
}

export default function MyPlayerCard() {
  const [state, setState] = useState({ status: 'loading', player: null, error: '' });
  const [foot, setFoot] = useState('');
  const [portrait, setPortrait] = useState(null); // { file, url, status: 'local' | 'uploading' | 'failed' }
  const [removePortrait, setRemovePortrait] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading', error: '' }));
    const { data, error: err } = await supabase.rpc('my_player');
    if (err) { setState({ status: 'error', player: null, error: err.message || 'Your player card could not be loaded.' }); return; }
    setState({ status: data ? 'linked' : 'unlinked', player: data, error: '' });
    setFoot(footOf(data)); setPortrait(null); setRemovePortrait(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (state.status === 'loading') return <section aria-label="Your player card" aria-busy="true" className="space-y-3">
    <h2 className="text-xl font-black uppercase tracking-tight text-white">Your player card</h2>
    <div className="h-[260px] w-[200px] animate-pulse rounded-2xl bg-white/5" />
  </section>;
  if (state.status === 'error') return <section aria-label="Your player card" className="space-y-3">
    <h2 className="text-xl font-black uppercase tracking-tight text-white">Your player card</h2>
    <p role="alert" className="text-sm text-red-300">{state.error} <button type="button" onClick={load} className="underline">Try again</button></p>
  </section>;
  if (state.status === 'unlinked') return <section aria-label="Your player card" className="space-y-2">
    <h2 className="text-xl font-black uppercase tracking-tight text-white">Your player card</h2>
    <p className="text-sm text-zinc-400">No player is linked to your account. If you play in a division, ask a dictator to link your player to this account.</p>
  </section>;

  const player = state.player;
  const changed = foot !== footOf(player) || Boolean(portrait) || removePortrait;
  const bio = { ...(player.attributes?.bio || {}) };
  if (foot) bio.preferredFoot = foot; else delete bio.preferredFoot;
  const preview = { ...player, image_url: removePortrait ? null : player.image_url, attributes: { ...(player.attributes || {}), bio } };

  const choose = (file) => {
    if (!file) return;
    if (file.type && file.type !== 'image/png') { setError('Choose a PNG image (500 × 500).'); return; }
    setError(''); setMessage(''); setRemovePortrait(false);
    setPortrait({ file, url: URL.createObjectURL(file), status: 'local' });
  };
  const save = async () => {
    setSaving(true); setError(''); setMessage('');
    let imageUrl = removePortrait ? null : player.image_url;
    if (portrait) {
      setPortrait((p) => ({ ...p, status: 'uploading' }));
      try { imageUrl = await uploadOwnPortrait(portrait.file); } catch (e) {
        setPortrait((p) => ({ ...p, status: 'failed' }));
        setError(`Your portrait did not upload: ${String(e.message).replace(/\.$/, '')}. Nothing was changed; try again.`);
        setSaving(false);
        return;
      }
    }
    const { error: err } = await supabase.rpc('update_my_player', { p_image_url: imageUrl, p_preferred_foot: foot || null });
    setSaving(false);
    if (err) {
      if (portrait) setPortrait((p) => ({ ...p, status: 'failed' }));
      setError(`Your card was not saved: ${String(err.message || 'the change was refused').replace(/\.$/, '')}.`);
      return;
    }
    setMessage('Your player card is saved.');
    await load();
  };

  return <section aria-label="Your player card" className="space-y-4">
    <h2 className="text-xl font-black uppercase tracking-tight text-white">Your player card</h2>
    <p className="text-xs text-zinc-500">You can change your portrait and preferred foot. Your name, rating, stats and play style are set by your captain or a dictator.</p>
    {player.email && <p className="text-sm text-zinc-300">Email: <span className="font-bold text-white">{player.email}</span> <span className="text-xs text-zinc-500">(your sign-in email; it cannot be changed here)</span></p>}
    <div className="flex flex-wrap items-start gap-4">
      <FutCard details player={preview} portrait={portrait || undefined} />
      <div className="space-y-3">
        <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500">Preferred foot
          <select aria-label="Preferred foot" value={foot} onChange={(e) => { setFoot(e.target.value); setMessage(''); }}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm normal-case tracking-normal text-white">
            <option value="">Not set</option>{FEET.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label className="flex cursor-pointer items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-zinc-300 hover:bg-white/5">
          <ImagePlus size={13} /> {portrait ? 'Choose another picture' : 'New portrait (500 × 500 PNG)'}
          <input type="file" accept="image/png" className="sr-only" aria-label="Portrait file" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {portrait && <button type="button" onClick={() => setPortrait(null)} className="text-xs text-zinc-400 underline">Discard new picture</button>}
        {!portrait && player.image_url && !removePortrait && <button type="button" onClick={() => setRemovePortrait(true)} className="block text-xs text-zinc-400 underline">Remove portrait</button>}
        {removePortrait && <button type="button" onClick={() => setRemovePortrait(false)} className="block text-xs text-zinc-400 underline">Keep portrait</button>}
        <button type="button" onClick={save} disabled={!changed || saving}
          className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-black uppercase text-black disabled:opacity-40">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {saving ? 'Saving...' : portrait?.status === 'failed' ? 'Retry' : 'Save card'}
        </button>
      </div>
    </div>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {message && <p role="status" className="text-sm text-emerald-300">{message}</p>}
    {player.seasons?.length > 0 && <div>
      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Seasons</p>
      <ul aria-label="Your seasons" className="mt-1 space-y-1 text-sm text-zinc-300">
        {player.seasons.map((s, i) => <li key={i}>{s.division} · {s.season}{s.is_current ? ' (current)' : ''}: {s.team}{s.jersey_number != null ? ` · #${s.jersey_number}` : ''}{s.position ? ` · ${s.position}` : ''}</li>)}
      </ul>
    </div>}
  </section>;
}
