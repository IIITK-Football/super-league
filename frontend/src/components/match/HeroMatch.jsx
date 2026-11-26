import { Link } from 'react-router-dom';
import { Goal } from 'lucide-react';
import { Crest, Scoreline } from '../ui';
import { cn } from '../../utils/cn';
import { FormGuide } from '../FormGuide';
import { isLive, isUpcoming } from './matchState';

const team = (value) => (Array.isArray(value) ? value[0] : value) ?? {};

// One side of the hero: crest, name, recent form and the goals scored so far.
function Side({ name, logo, form, scorers, away }) {
  return (
    <div className={cn('flex min-w-0 flex-1 flex-col items-center gap-3 text-center', away && 'opacity-95')}>
      <Crest name={name} src={logo} size="lg" className="ring-1 ring-white/15 shadow-[0_10px_30px_-10px_rgb(0_0_0/0.8)]" />
      <h3 className="line-clamp-2 font-display text-lg font-black uppercase leading-[0.95] tracking-tight text-white sm:text-3xl lg:text-4xl">{name}</h3>
      {form?.length > 0 && <div className="hidden sm:block"><FormGuide form={form.slice(-5)} /></div>}
      {scorers?.length > 0 && (
        <ul className="flex flex-col items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-white/70 sm:text-xs">
          {scorers.map((s, i) => (
            <li key={`${s.name}-${i}`} className="flex items-center gap-1.5">
              <Goal size={11} aria-hidden="true" className="text-white/50" />
              <span>{s.name}</span>
              {s.minute != null && <span className="text-white/45">{s.minute}&prime;</span>}
              {s.isOwnGoal && <span className="rounded bg-live/25 px-1 text-[9px] text-white">OG</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The match a visitor sees first, on a night pitch seen from above. A live match gets a travelling light on its
// border and its minute; a scheduled one shows its kick-off. detail (from the dashboard) adds form and scorers.
export function HeroMatch({ match, detail, className }) {
  const home = team(match.home);
  const away = team(match.away);
  const live = isLive(match);
  const upcoming = isUpcoming(match);
  const when = match.date ? new Date(match.date) : null;
  const minute = detail?.minute ?? match.minute;
  const status = live
    ? (minute === 'HT' ? 'Half time' : `Live${minute && minute !== 'LIVE' ? ` · ${minute}′` : ''}`)
    : upcoming
      ? when?.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) ?? 'Upcoming'
      : 'Full time';

  return (
    <Link
      to={`/matches/${match.id}`}
      aria-label={`${home.name} against ${away.name}, ${status}`}
      className={cn('pitch lift group block rounded-card border border-white/10 px-4 pb-7 pt-5 sm:px-8 sm:pb-10 sm:pt-7', live && 'beam', className)}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2.5 rounded-pill border border-white/15 bg-black/50 px-4 py-1.5 text-[11px] font-black uppercase tracking-[0.25em] text-white backdrop-blur-md">
          {live && (
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-live" />
            </span>
          )}
          {status}
        </span>
        {match.venue && <span className="hidden text-[11px] font-bold uppercase tracking-[0.2em] text-white/55 sm:inline">{match.venue}</span>}
      </div>

      <div className="mt-6 flex items-start gap-2 sm:mt-8 sm:gap-6">
        <Side name={home.name || 'To be confirmed'} logo={home.logo_url} form={detail?.homeForm} scorers={detail?.homeScorers} />
        <div className="flex shrink-0 flex-col items-center pt-3 sm:pt-4">
          {upcoming
            ? <span className="font-display text-4xl font-black uppercase tracking-tighter text-white/80 sm:text-7xl">vs</span>
            : <Scoreline home={match.home_score ?? null} away={match.away_score ?? null} live={live} size="lg" className="chrome text-white drop-shadow-[0_6px_24px_rgb(0_0_0/0.6)]" />}
        </div>
        <Side name={away.name || 'To be confirmed'} logo={away.logo_url} form={detail?.awayForm} scorers={detail?.awayScorers} away />
      </div>
    </Link>
  );
}
