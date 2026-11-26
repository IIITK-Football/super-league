import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE_URL } from '../../lib/api';

// Live and upcoming matches across every division, scrolling like a broadcast ticker. Hidden when nothing is on.
export function LiveTicker({ divisions }) {
  const [items, setItems] = useState([]);
  const slugs = divisions.map((d) => d.slug).join(',');

  useEffect(() => {
    if (!slugs) return undefined;
    let cancelled = false;
    Promise.all(divisions.map((d) => fetch(`${API_BASE_URL}/schedule?division=${encodeURIComponent(d.slug)}&limit=6`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => (Array.isArray(body?.data) ? body.data : []).map((m) => ({ ...m, division: d })))
      .catch(() => [])))
      .then((lists) => {
        if (cancelled) return;
        const all = lists.flat();
        const live = all.filter((m) => m.status === 'live');
        setItems(live.length ? live : all.filter((m) => m.status === 'scheduled').slice(0, 6));
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugs]);

  if (items.length === 0) return null;
  const anyLive = items.some((m) => m.status === 'live');
  const row = items.map((m) => (
    <Link key={`${m.division.slug}-${m.id}`} to={`/matches/${m.id}`} className="flex shrink-0 items-center gap-2.5 px-5 text-xs font-bold uppercase tracking-wider text-mut hover:text-ink">
      <span className="text-[10px] tracking-[0.2em] text-mut/70">{m.division.name}</span>
      <span className="text-ink">{m.home_team}</span>
      <span className="font-display tabular-nums text-ink">
        {m.status === 'live' ? `${m.home_score ?? 0} - ${m.away_score ?? 0}` : new Date(m.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
      <span className="text-ink">{m.away_team}</span>
      <span aria-hidden="true" className="text-line">/</span>
    </Link>
  ));

  return (
    <div className="relative flex h-8 items-center overflow-hidden border-b border-line bg-bg text-ink">
      <span className="z-10 flex h-full shrink-0 items-center gap-2 bg-bg pl-4 pr-3 text-[10px] font-black uppercase tracking-[0.25em] sm:pl-6">
        {anyLive && <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-75" /><span className="relative inline-flex size-2 rounded-full bg-live" /></span>}
        {anyLive ? 'Live' : 'Next'}
      </span>
      <div className="group flex min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_4%,#000_96%,transparent)]">
        {/* Two copies make the loop seamless; the second is hidden from screen readers. */}
        <div className="flex w-max animate-marquee group-hover:[animation-play-state:paused]">
          <div className="flex shrink-0">{row}</div>
          <div className="flex shrink-0" aria-hidden="true" inert="">{row}</div>
        </div>
      </div>
    </div>
  );
}
