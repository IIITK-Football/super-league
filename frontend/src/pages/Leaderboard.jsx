/* eslint-disable react/prop-types -- this codebase does not use prop-types */
import { useLeague } from '../context/LeagueContext';
import { useApi } from '../hooks/useApi';
import { EmptyState, ErrorState, NumberTicker, Skeleton } from '../components/ui';
import { cn } from '../utils/cn';

const PLACE = ['1st', '2nd', '3rd'];

// The top three as a podium: the leader is the big tile, the next two sit beside it.
function Podium({ rows, label, unit }) {
  const [first, ...others] = rows;
  return (
    <div className="space-y-4">
      <div className="glass flex flex-col justify-between gap-8 rounded-card p-6 sm:p-8">
        <div className="space-y-3">
          <p className="eyebrow">{PLACE[0]} · {label}</p>
          <p className="font-display text-3xl leading-none text-ink sm:text-4xl">{first.name}</p>
          {first.club && <p className="eyebrow">{first.club}</p>}
        </div>
        <p className="flex items-baseline gap-3">
          <NumberTicker value={first.stat} className="chrome font-display text-8xl leading-none tabular-nums text-ink" />
          <span className="eyebrow">{unit}</span>
        </p>
      </div>
      {others.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {others.map((player, i) => (
            <div key={player.id || i} className="glass flex flex-col justify-between gap-6 rounded-card p-5">
              <div className="space-y-2">
                <p className="eyebrow">{PLACE[i + 1]}</p>
                <p className="font-display text-xl leading-none text-ink sm:text-2xl">{player.name}</p>
                {player.club && <p className="eyebrow truncate">{player.club}</p>}
              </div>
              <NumberTicker value={player.stat} className="chrome font-display text-5xl leading-none tabular-nums text-ink" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// One stat: the podium, then the rest of the ranked list.
function StatBoard({ caption, label, unit, rows, statKey }) {
  const ranked = rows.map((p) => ({ ...p, stat: p[statKey] || 0 }));
  return (
    <section aria-label={caption} className="space-y-6">
      <h2 className="font-display text-3xl text-ink sm:text-4xl">{caption}</h2>
      {ranked.length === 0 ? (
        <EmptyState title={`No ${label.toLowerCase()} yet`} />
      ) : (
        <>
          <Podium rows={ranked.slice(0, 3)} label={label} unit={unit} />
          {ranked.length > 3 && (
            <ol className="glass divide-y divide-line/70 rounded-card px-5 sm:px-6">
              {ranked.slice(3).map((player, index) => (
                <li key={`${statKey}-${player.id || index}`} className="flex min-h-14 items-center gap-4 py-3">
                  <span className="eyebrow w-8 shrink-0 tabular-nums">{index + 4}</span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-black uppercase tracking-tight text-ink">{player.name}</span>
                    <span className="eyebrow truncate">{player.club}</span>
                  </div>
                  <span className={cn('font-display text-3xl leading-none tabular-nums text-ink')}>{player.stat}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

// Player stats: goals and assists for the selected division and season. (Predictions are on the Predictions page.)
export function Leaderboard() {
  const { seasonScope } = useLeague();
  const { data: apiResponse, loading, error, retry } = useApi('/leaderboard');

  const topScorers = apiResponse?.data?.topScorers || [];
  const topAssists = apiResponse?.data?.topAssists || [];
  const divisionName = seasonScope.divisionRecord?.name;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-14 pb-12">
      <header className="space-y-3">
        <p className="eyebrow">{divisionName ? `${divisionName}${seasonScope.season && seasonScope.seasons.length > 1 ? ` ${seasonScope.season.name}` : ''}` : 'Division'}</p>
        <h1 className="font-display text-4xl text-ink sm:text-6xl">Player stats</h1>
      </header>

      {loading && (
        <div aria-busy="true" className="grid gap-12 lg:grid-cols-2">
          <Skeleton className="h-96 w-full rounded-card" />
          <Skeleton className="h-96 w-full rounded-card" />
        </div>
      )}
      {!loading && error && <ErrorState title="Could not load player stats" message={error.message} onRetry={retry} />}
      {!loading && !error && (
        <div className="grid gap-14 lg:grid-cols-2">
          <StatBoard caption="Top scorers" label="Goals" unit="goals" rows={topScorers} statKey="goalsScored" />
          <StatBoard caption="Top assists" label="Assists" unit="assists" rows={topAssists} statKey="assists" />
        </div>
      )}
    </div>
  );
}
