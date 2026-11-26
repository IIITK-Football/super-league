import { Link } from 'react-router-dom';
import { Crest, Pill, Scoreline } from '../ui';
import { cn } from '../../utils/cn';
import { isLive, isUpcoming, timeLabel } from './matchState';

const STATUS = {
  live: { label: 'Live', tone: 'live' },
  completed: { label: 'Full time', tone: 'neutral' },
  forfeited: { label: 'Forfeit', tone: 'neutral' },
  scheduled: { label: 'Upcoming', tone: 'acc' },
};

// Team objects come as { name, logo_url }; some API shapes wrap them in an array.
const team = (value) => (Array.isArray(value) ? value[0] : value) ?? {};

// Pills on the featured block take the block's ink so they read on it (the tone colours would not).
const FEATURED_PILL = 'bg-blkink/15 text-blkink';

function Side({ name, logo, home, featured }) {
  return (
    <div className={cn('flex min-w-0 flex-1 flex-col items-center gap-2 text-center',
      featured && (home ? 'sm:flex-row-reverse sm:gap-3 sm:text-right' : 'sm:flex-row sm:gap-3 sm:text-left'))}>
      <Crest name={name} src={logo} size="md" />
      <span className={cn('line-clamp-2 min-w-0 break-words font-semibold leading-tight sm:text-base', featured ? 'text-base text-blkink sm:text-2xl' : 'text-sm font-black uppercase tracking-tight text-ink')}>{name}</span>
    </div>
  );
}

// One match as a scoreboard strip: home | score | away, with the status and date or venue below. The whole strip
// is a link to the match. Missing scores show a dash; a scheduled match shows its kick-off time instead.
// featured: the one loud block on a page (the division home's hero match), in the signature colour.
export function MatchStrip({ match, className, featured = false }) {
  const home = team(match.home);
  const away = team(match.away);
  const live = isLive(match);
  const status = STATUS[match.status] ?? { label: match.status || 'Unknown', tone: 'neutral' };
  const statusLabel = live && match.minute != null ? `Live ${match.minute}'` : status.label;
  const when = match.date ? new Date(match.date) : null;
  const detail = [when && when.toLocaleDateString(undefined, isUpcoming(match) ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' }),
    match.venue].filter(Boolean).join(' · ');

  return (
    <Link
      to={`/matches/${match.id}`}
      className={cn('block rounded-card p-4 transition-colors duration-200 sm:p-5',
        featured ? 'border-blk bg-blk text-blkink sm:p-8' : 'glass lift', className)}
    >
      <div className="flex items-center gap-3">
        <Side name={home.name || 'To be confirmed'} logo={home.logo_url} home featured={featured} />
        <div className="shrink-0 text-center">
          {isUpcoming(match)
            ? <span className={cn('font-display font-bold tabular-nums leading-none', featured ? 'text-6xl text-blkink sm:text-8xl' : 'text-2xl text-ink')}>{timeLabel(when) || '-'}</span>
            : <Scoreline home={match.home_score ?? null} away={match.away_score ?? null} live={live} size={featured ? 'lg' : 'md'} className={featured ? 'text-blkink' : undefined} />}
        </div>
        <Side name={away.name || 'To be confirmed'} logo={away.logo_url} featured={featured} />
      </div>
      <div className={cn('mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm', featured ? 'text-blkink' : 'text-mut')}>
        {!isUpcoming(match) && <Pill tone={status.tone} className={featured ? FEATURED_PILL : undefined}>{statusLabel}</Pill>}
        {detail && <span className={featured ? 'text-blkink/80' : undefined}>{detail}</span>}
      </div>
    </Link>
  );
}
