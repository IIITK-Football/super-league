import { useEffect, useState } from 'react';
import { CalendarClock, Save } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { FRESHERS_FIXTURES } from '../../data/freshersFixtures';

const initialFixtures = FRESHERS_FIXTURES.map((item) => ({
  fixture_key: item.key,
  match_date: item.date,
  start_time: item.time,
  round: item.round,
  fixture: item.fixture,
  display_order: item.order,
}));
const inputClass = 'w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2.5 text-sm text-white outline-none focus:border-white/40';

export default function ManageRoadToFinal() {
  const [fixtures, setFixtures] = useState(initialFixtures);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    supabase.from('freshers_fixtures').select('*').order('display_order').then(({ data, error: loadError }) => {
      if (!active) return;
      if (loadError) setError(`Could not load saved fixtures. Run the new Road to Final database migration. ${loadError.message}`);
      if (data?.length) setFixtures(data.map((item) => ({ ...item, start_time: String(item.start_time).slice(0, 5) })));
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const updateFixture = (key, field, value) => setFixtures((current) => current.map((item) => item.fixture_key === key ? { ...item, [field]: value } : item));

  const saveFixture = async (fixture) => {
    setSavingKey(fixture.fixture_key);
    setError('');
    setMessage('');
    const { error: saveError } = await supabase.from('freshers_fixtures').upsert({
      fixture_key: fixture.fixture_key,
      match_date: fixture.match_date,
      start_time: fixture.start_time,
      round: fixture.round,
      fixture: fixture.fixture,
      display_order: fixture.display_order,
    }, { onConflict: 'fixture_key' });
    if (saveError) setError(saveError.message);
    else setMessage(`${fixture.round} time saved. The Road to Final is updated for everyone.`);
    setSavingKey('');
  };

  return <div className="space-y-6 p-5 sm:p-6">
    <header><h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-tight"><CalendarClock size={21} /> Freshers Road to Final</h2><p className="mt-1 text-xs uppercase tracking-widest text-zinc-500">Set Freshers match dates and kick-off slots here. Schedule WSL bracket matches from the Schedule tab; those fixtures feed the WSL Road to Final.</p></header>
    {error && <p className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
    {message && <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">{message}</p>}
    {loading ? <p className="text-sm text-zinc-500">Loading fixture slots…</p> : <div className="space-y-3">{fixtures.map((fixture) => <section key={fixture.fixture_key} className="grid gap-3 rounded-xl border border-white/10 bg-black/30 p-4 sm:grid-cols-[110px_1fr_150px_150px_auto] sm:items-end">
      <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Round<input value={fixture.round} onChange={(event) => updateFixture(fixture.fixture_key, 'round', event.target.value)} className={`${inputClass} mt-1`} /></label>
      <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Fixture<input value={fixture.fixture} onChange={(event) => updateFixture(fixture.fixture_key, 'fixture', event.target.value)} className={`${inputClass} mt-1`} /></label>
      <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Date<input type="date" value={fixture.match_date} onChange={(event) => updateFixture(fixture.fixture_key, 'match_date', event.target.value)} className={`${inputClass} mt-1 [color-scheme:dark]`} /></label>
      <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Kick-off<input type="time" value={fixture.start_time} onChange={(event) => updateFixture(fixture.fixture_key, 'start_time', event.target.value)} className={`${inputClass} mt-1 [color-scheme:dark]`} /></label>
      <button type="button" onClick={() => saveFixture(fixture)} disabled={savingKey === fixture.fixture_key} className="flex items-center justify-center gap-2 rounded-lg bg-[#d9ff4a] px-4 py-2.5 text-xs font-black uppercase text-black disabled:opacity-50"><Save size={14} />{savingKey === fixture.fixture_key ? 'Saving' : 'Save'}</button>
    </section>)}</div>}
  </div>;
}
