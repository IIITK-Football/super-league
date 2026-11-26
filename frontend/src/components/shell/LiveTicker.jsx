import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE_URL } from '../../lib/api';

const REFRESH_MS = 60_000;
// The last list shown, so a remounted shell starts with it instead of an empty strip.
let lastItems = [];

// Live and upcoming matches across every division, scrolling like a broadcast ticker. The strip keeps its height
// whether or not anything is on, so the header below it never moves.
export function LiveTicker({ divisions }) {
  const [items, setItems] = useState(lastItems);
  const slugs = divisions.map((d) => d.slug).join(',');

  useEffect(() => {
    if (!slugs) return undefined;
    let cancelled = false;
    const load = () => Promise.all(divisions.map((d) => fetch(`${API_BASE_URL}/schedule?division=${encodeURIComponent(d.slug)}&limit=6`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => (Array.isArray(body?.data) ? body.data.map((m) => ({ ...m, division: d })) : null))
      .catch(() => null)))
      .then((lists) => {
        // Every request failed: keep what is on screen.
        if (cancelled || lists.every((list) => list === null)) return;
        const all = lists.flat().filter(Boolean);
        const live = all.filter((m) => m.status === 'live');
        lastItems = live.length ? live : all.filter((m) => m.status === 'scheduled').slice(0, 6);
        setItems(lastItems);
      });
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugs]);

  const anyLive = items.some((m) => m.status === 'live');
  const row = items.map((m) => (
    <Link key={`${m.division.slug}-${m.id}`} to={`/matches/${m.id}`} className="flex shrink-0 items-center gap-2.5 px-5 text-xs font-bold uppercase tracking-wider text-mut transition-colors hover:text-ink">
      <span className="text-[10px] tracking-[0.2em] text-mut/70">{m.division.short_name || m.division.name}</span>
      <span className="text-ink">{m.home_team}</span>
      <span className="font-display tabular-nums text-ink">
        {m.status === 'live' ? `${m.home_score ?? 0} - ${m.away_score ?? 0}` : new Date(m.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
      <span className="text-ink">{m.away_team}</span>
      <span aria-hidden="true" className="text-line">/</span>
    </Link>
  ));

  return (
    <div className="relative flex h-8 items-center overflow-hidden border-b border-line/60 bg-bg/85 text-ink backdrop-blur-xl">
      {items.length === 0 ? (
        <span className="eyebrow px-4 sm:px-6">Super League · IIIT Kottayam</span>
      ) : (
        <>
          <span className="z-10 flex h-full shrink-0 items-center gap-2 pl-4 pr-3 text-[10px] font-black uppercase tracking-[0.25em] sm:pl-6">
            {anyLive && <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-75" /><span className="relative inline-flex size-2 rounded-full bg-live" /></span>}
            {anyLive ? 'Live' : 'Next'}
          </span>
          <div className="group flex min-w-0 flex-1 overflow-hidden motion-safe:animate-fade-in [mask-image:linear-gradient(90deg,transparent,#000_4%,#000_96%,transparent)]">
            {/* Two copies make the loop seamless; the second is hidden from screen readers. */}
            <div className="flex w-max animate-marquee group-hover:[animation-play-state:paused]">
              <div className="flex shrink-0">{row}</div>
              <div className="flex shrink-0" aria-hidden="true" inert="">{row}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
