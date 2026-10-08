import { useEffect, useState } from 'react';
import { Clock3, Trophy } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { FRESHERS_FIXTURES } from '../data/freshersFixtures';

const formatDate = (date) => new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' });
const formatTime = (time) => {
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(2020, 0, 1, hours, minutes).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
};

export function FreshersRoadToFinal() {
  const [fixtures, setFixtures] = useState(FRESHERS_FIXTURES);

  useEffect(() => {
    let active = true;
    supabase.from('freshers_fixtures').select('fixture_key, match_date, start_time, round, fixture, display_order').order('display_order')
      .then(({ data }) => {
        if (active && data?.length) setFixtures(data.map((item) => ({
          key: item.fixture_key,
          date: item.match_date,
          time: String(item.start_time).slice(0, 5),
          round: item.round,
          fixture: item.fixture,
          order: item.display_order,
        })));
      });
    return () => { active = false; };
  }, []);

  const days = [...new Set(fixtures.map((fixture) => fixture.date))];

  return <section className="space-y-8 animate-in fade-in duration-500 pb-12">
    <header className="text-center space-y-3">
      <p className="text-xs font-black tracking-[.3em] uppercase text-zinc-500">Freshers Tournament · Knockout</p>
      <h1 className="flex items-center justify-center gap-3 text-3xl sm:text-5xl font-black tracking-tighter uppercase"><span className="h-4 w-4 bg-white sm:h-5 sm:w-5" />Fresher&apos;s Tournament Fixtures</h1>
      <p className="mx-auto max-w-2xl text-sm text-zinc-400">Follow every knockout fixture from the quarter-finals to the final.</p>
    </header>

    {days.map((date) => <section key={date} className="mx-auto w-full max-w-5xl space-y-3">
      <h2 className="text-center text-2xl font-black uppercase tracking-tight text-white sm:text-3xl">{formatDate(date)}</h2>
      <div className="overflow-hidden rounded-xl border border-white/10 bg-black/40">
        <div className="grid grid-cols-[105px_92px_minmax(0,1fr)] gap-3 border-b border-white/10 bg-[#111827] px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white sm:grid-cols-[160px_120px_minmax(0,1fr)] sm:px-6">
          <span>Start Time</span><span>Round</span><span>Fixture</span>
        </div>
        {fixtures.filter((fixture) => fixture.date === date).map((fixture) => <div key={fixture.key} className="grid grid-cols-[105px_92px_minmax(0,1fr)] gap-3 border-b border-white/10 bg-white/[.04] px-4 py-4 last:border-0 sm:grid-cols-[160px_120px_minmax(0,1fr)] sm:px-6">
          <span className="flex items-center gap-1.5 text-xs font-bold text-zinc-200 sm:text-sm"><Clock3 size={13} className="shrink-0 text-zinc-500" />{formatTime(fixture.time)}</span>
          <span className="text-xs font-black uppercase text-zinc-300 sm:text-sm">{fixture.round}</span>
          <span className="text-xs font-bold text-white sm:text-sm">{fixture.fixture}</span>
        </div>)}
      </div>
    </section>)}

    <div className="mx-auto flex max-w-4xl items-center justify-center gap-2 rounded-xl border border-amber-300/20 bg-amber-300/[.06] p-4 text-center text-xs font-bold uppercase tracking-wider text-amber-100"><Trophy size={16} className="shrink-0 text-amber-300" /> One winner. One road to the final.</div>
  </section>;
}
