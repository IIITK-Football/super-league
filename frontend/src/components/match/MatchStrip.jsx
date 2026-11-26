import { Link } from 'react-router-dom';
import { Crest, Scoreline } from '../ui';
import { cn } from '../../utils/cn';
import { isLive, isUpcoming, timeLabel } from './matchState';

const team = (value) => (Array.isArray(value) ? value[0] : value) ?? {};

const STATUS_TEXT = { completed: 'Full time', forfeited: 'Forfeit' };

function Side({ name, logo, home, featured }) {
  return (
    <div className={cn('flex min-w-0 flex-1 flex-col items-center gap-2 text-center',
      featured && (home ? 'sm:flex-row-reverse sm:gap-3 sm:text-right' : 'sm:flex-row sm:gap-3 sm:text-left'))}>
      <Crest name={name} src={logo} size={featured ? 'lg' : 'md'} />
      <span className={cn('line-clamp-2 min-w-0 break-words leading-[0.95]',
        featured ? 'font-display text-lg font-black uppercase tracking-tight text-blkink sm:text-3xl'
          : 'font-display text-sm font-black uppercase tracking-tight text-ink')}>{name}</span>
    </div>
  );
}

// One match as a scoreboard tile: home | score | away, then a line of status, date and venue. The whole tile links to
// the match. A live match gets the live dot and a travelling light; a scheduled one shows its kick-off in the middle.
// featured: the one loud block on a page (the division home's hero match), in the signature colour.
export function MatchStrip({ match, className, featured = false }) {
  const home = team(match.home);
  const away = team(match.away);
  const live = isLive(match);
  const upcoming = isUpcoming(match);
  const when = match.date ? new Date(match.date) : null;
  const status = live
    ? (match.minute != null ? `Live ${match.minute}'` : 'Live')
    : STATUS_TEXT[match.status] ?? '';
  const date = when && when.toLocaleDateString(undefined, upcoming
    ? { weekday: 'short', day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short' });
  const meta = [date, match.venue].filter(Boolean).join(' · ');

  return (
    <Link
      to={`/matches/${match.id}`}
      className={cn('block rounded-card p-4 sm:p-5',
        featured ? 'border-blk bg-blk text-blkink sm:p-8' : 'glass lift', live && !featured && 'beam', className)}
    >
      <div className="flex items-center gap-3">
        <Side name={home.name || 'To be confirmed'} logo={home.logo_url} home featured={featured} />
        <div className="shrink-0 text-center">
          {upcoming
            ? <span className={cn('font-display font-black tabular-nums leading-none', featured ? 'text-5xl text-blkink sm:text-7xl' : 'text-2xl text-ink')}>{timeLabel(when) || '-'}</span>
            : <Scoreline home={match.home_score ?? null} away={match.away_score ?? null} live={live} size={featured ? 'lg' : 'md'} className={featured ? 'text-blkink' : undefined} />}
        </div>
        <Side name={away.name || 'To be confirmed'} logo={away.logo_url} featured={featured} />
      </div>
      <p className={cn('eyebrow mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center',
        featured && 'text-blkink/70')}>
        {live && <span aria-hidden="true" className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-live" />
        </span>}
        {status && <span className={cn(live && (featured ? 'text-blkink' : 'text-live'))}>{status}</span>}
        {meta && <span>{meta}</span>}
      </p>
    </Link>
  );
}
