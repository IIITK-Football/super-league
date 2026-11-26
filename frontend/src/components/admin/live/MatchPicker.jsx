import { Combobox, Crest, EmptyState, Field, Scoreline } from '../../ui';
import { cn } from '../../../utils/cn';
import { formatKickoff } from '../adminFormat';
import { clockMinute, inFirstHalf, minuteLabel } from './clock';

const NEXT_FIXTURES = 6;
const vs = (m) => `${m.home_team_name} vs ${m.away_team_name}`;

function LiveDot() {
  return (
    <span aria-hidden="true" className="relative flex size-2">
      <span className="absolute inline-flex size-full rounded-full bg-live opacity-75 motion-safe:animate-ping" />
      <span className="relative inline-flex size-2 rounded-full bg-live" />
    </span>
  );
}

// The eyebrow of a row: the live minute, half time, or the kick-off.
function rowMeta(m) {
  if (m.status === 'live') {
    if (m.minute === 'HT') return 'Half time';
    const minute = clockMinute(m);
    return `Live${minute !== null ? ` · ${minuteLabel(minute, inFirstHalf(m))}′` : ''}`;
  }
  return [formatKickoff(m.date), m.venue].filter(Boolean).join(' · ') || 'No kick-off time';
}

function MatchRow({ match, crest, current, onPick, children }) {
  const live = match.status === 'live';
  return (
    <li className={cn('flex items-center gap-2 px-3 py-2', current && 'bg-ink/[0.06]')}>
      <button
        type="button"
        aria-pressed={current}
        onClick={() => onPick(match)}
        className="flex min-h-14 min-w-0 flex-1 flex-col justify-center gap-1.5 rounded-ctl text-left outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
      >
        <span className={cn('eyebrow flex items-center gap-2', live && 'text-live')}>{live && <LiveDot />}{rowMeta(match)}</span>
        <span className="flex min-w-0 items-center gap-2">
          <Crest size="sm" name={match.home_team_name} src={crest(match.home_team_id)?.logo_url} color={crest(match.home_team_id)?.team_color} />
          <span className="min-w-0 flex-1 truncate text-sm font-black uppercase tracking-tight text-ink">{vs(match)}</span>
          {match.status !== 'scheduled' && <Scoreline home={match.home_score} away={match.away_score} size="sm" />}
          <Crest size="sm" name={match.away_team_name} src={crest(match.away_team_id)?.logo_url} color={crest(match.away_team_id)?.team_color} />
        </span>
      </button>
      {children}
    </li>
  );
}

// Live matches first, then the next fixtures; every other match (later fixtures, older results) is one search away.
// Recent results keep their Correct and Reopen actions.
export function MatchPicker({ matches, finished, older, selectedId, crest, emptyTitle, emptyText, onPick, onReopen, className }) {
  const live = matches.filter((m) => m.status === 'live');
  const upcoming = matches.filter((m) => m.status !== 'live');
  const next = upcoming.slice(0, NEXT_FIXTURES);
  const rest = [...upcoming.slice(NEXT_FIXTURES), ...older];
  const pick = (id) => onPick([...rest, ...finished].find((m) => m.id === id));

  return (
    <div className={cn('space-y-8', className)}>
      <section aria-labelledby="live-heading" className="space-y-3">
        <h2 id="live-heading" className="font-display text-2xl font-black uppercase tracking-tight text-ink">Matchday</h2>
        {live.length + next.length > 0 ? (
          <ul className="glass divide-y divide-line/70 overflow-hidden rounded-card">
            {[...live, ...next].map((m) => <MatchRow key={m.id} match={m} crest={crest} current={selectedId === m.id} onPick={onPick} />)}
          </ul>
        ) : (
          <EmptyState title={emptyTitle}>{emptyText}</EmptyState>
        )}
        {rest.length > 0 && (
          <Field label="Another match">
            {(p) => (
              <Combobox
                {...p}
                value={rest.some((m) => m.id === selectedId) ? selectedId : undefined}
                onChange={pick}
                placeholder="Search by team"
                searchPlaceholder="Search by team"
                options={rest.map((m) => ({ value: m.id, label: vs(m), description: formatKickoff(m.date) || m.status }))}
              />
            )}
          </Field>
        )}
      </section>

      <section aria-labelledby="finished-heading" className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="finished-heading" className="font-display text-2xl font-black uppercase tracking-tight text-ink">Finished matches</h2>
          <span className="eyebrow">Last 7 days</span>
        </div>
        {finished.length > 0 ? (
          <ul className="glass divide-y divide-line/70 overflow-hidden rounded-card">
            {finished.map((m) => (
              <MatchRow key={m.id} match={m} crest={crest} current={selectedId === m.id} onPick={onPick}>
                <span className="flex shrink-0 flex-col">
                  <button type="button" aria-label={`Correct ${vs(m)}`} onClick={() => onPick(m)} className="eyebrow min-h-11 px-2 hover:text-ink">Correct</button>
                  <button type="button" aria-label={`Reopen ${vs(m)}`} onClick={() => onReopen(m)} className="eyebrow min-h-11 px-2 hover:text-ink">Reopen</button>
                </span>
              </MatchRow>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-mut">No matches finished in the last 7 days.</p>
        )}
      </section>
    </div>
  );
}
