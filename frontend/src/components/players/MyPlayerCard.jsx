import { useCallback, useEffect, useState } from 'react';
import { ImagePlus, Loader2, Save } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { API_BASE_URL } from '../../lib/api';
import { FEET } from '../../lib/playerCard';
import FutCard from './FutCard';
import { Skeleton } from '../ui/Skeleton';
import { Field } from '../ui/Field';
import { SegmentedControl } from '../ui/SegmentedControl';
import { toast } from '../ui/toastStore';

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

// The card promises a 500 x 500 PNG, so the picture itself is measured, not only its type.
function pictureSize(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(file);
  });
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
    <h2 className="font-display text-3xl text-ink sm:text-4xl">Your player card</h2>
    <Skeleton className="h-[380px] w-[260px] rounded-card" />
  </section>;
  if (state.status === 'error') return <section aria-label="Your player card" className="space-y-3">
    <h2 className="font-display text-3xl text-ink sm:text-4xl">Your player card</h2>
    <p role="alert" className="text-sm text-live">{state.error} <button type="button" onClick={load} className="underline">Try again</button></p>
  </section>;
  if (state.status === 'unlinked') return <section aria-label="Your player card" className="space-y-2">
    <h2 className="font-display text-3xl text-ink sm:text-4xl">Your player card</h2>
    <p className="text-sm text-mut">No player is linked to your account. If you play in a division, ask a dictator to link your player to this account.</p>
  </section>;

  const player = state.player;
  const changed = foot !== footOf(player) || Boolean(portrait) || removePortrait;
  const bio = { ...(player.attributes?.bio || {}) };
  if (foot) bio.preferredFoot = foot; else delete bio.preferredFoot;
  const preview = { ...player, image_url: removePortrait ? null : player.image_url, attributes: { ...(player.attributes || {}), bio } };

  const choose = async (file) => {
    if (!file) return;
    if (file.type && file.type !== 'image/png') { setError('Choose a PNG image (500 × 500).'); return; }
    const size = await pictureSize(file);
    if (size?.w !== 500 || size?.h !== 500) {
      setError(`Choose a 500 × 500 PNG. This picture is ${size ? `${size.w} × ${size.h}` : 'not a readable image'}.`);
      return;
    }
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
    toast({ title: 'Player card saved', tone: 'success' });
    await load();
  };

  return <section aria-label="Your player card" className="space-y-4">
    <h2 className="font-display text-3xl text-ink sm:text-4xl">Your player card</h2>
    <p className="text-sm text-mut">You can change your portrait and preferred foot. Your name, rating, stats and play style are set by your captain or a dictator.</p>
    {player.email && <p className="text-sm text-mut">Email: <span className="font-bold text-ink">{player.email}</span> <span className="text-xs text-mut">(your sign-in email; it cannot be changed here)</span></p>}
    <div className="flex flex-wrap items-start gap-4">
      <FutCard details player={preview} portrait={portrait || undefined} />
      <div className="space-y-3">
        <Field label="Preferred foot">
          {(p) => <SegmentedControl aria-labelledby={p['aria-labelledby']} value={foot} onChange={(v) => { setFoot(v); setMessage(''); }}
            options={[{ value: '', label: 'Not set' }, ...FEET.map((f) => ({ value: f, label: f }))]} />}
        </Field>
        <label className="glass inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-pill px-6 text-sm font-black uppercase tracking-[0.2em] text-ink focus-within:outline focus-within:outline-2 focus-within:outline-acc">
          <ImagePlus size={13} /> {portrait ? 'Choose another picture' : 'New portrait (500 × 500 PNG)'}
          <input type="file" accept="image/png" className="sr-only" aria-label="Portrait file" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {portrait && <button type="button" onClick={() => setPortrait(null)} className="min-h-11 text-sm text-mut underline">Discard new picture</button>}
        {!portrait && player.image_url && !removePortrait && <button type="button" onClick={() => setRemovePortrait(true)} className="block min-h-11 text-sm text-mut underline">Remove portrait</button>}
        {removePortrait && <button type="button" onClick={() => setRemovePortrait(false)} className="block min-h-11 text-sm text-mut underline">Keep portrait</button>}
        <button type="button" onClick={save} disabled={!changed || saving}
          className="inline-flex min-h-11 items-center gap-2 rounded-pill bg-ink px-6 text-sm font-black uppercase tracking-[0.2em] text-bg transition hover:opacity-85 disabled:opacity-40">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {saving ? 'Saving...' : portrait?.status === 'failed' ? 'Retry' : 'Save card'}
        </button>
      </div>
    </div>
    {error && <p role="alert" className="text-sm text-live">{error}</p>}
    {message && <p role="status" className="text-sm text-acc2">{message}</p>}
    {player.seasons?.length > 0 && <div>
      <p className="text-xs font-semibold text-mut">Seasons</p>
      <ul aria-label="Your seasons" className="mt-1 space-y-1 text-sm text-ink">
        {player.seasons.map((s, i) => <li key={i}>{s.division} · {s.season}{s.is_current ? ' (current)' : ''}: {s.team}{s.jersey_number != null ? ` · #${s.jersey_number}` : ''}{s.position ? ` · ${s.position}` : ''}</li>)}
      </ul>
    </div>}
  </section>;
}
