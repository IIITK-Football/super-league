import { useLeague } from '../context/LeagueContext';
import { useApi } from '../hooks/useApi';
import { Card, EmptyState, ErrorState, Skeleton, Table } from '../components/ui';

// Player stats: goals and assists for the selected division and season. (Predictions are on the Predictions page.)
function StatTable({ caption, label, rows, statKey }) {
  return (
    <Card as="section" aria-label={caption} className="flex flex-col gap-4">
      <h2 className="font-display text-2xl font-bold">{caption}</h2>
      {rows.length === 0 ? (
        <EmptyState title={`No ${label.toLowerCase()} yet`} />
      ) : (
        <Table caption={caption}>
          <thead>
            <tr><th scope="col">#</th><th scope="col">Player</th><th scope="col" className="text-right">{label}</th></tr>
          </thead>
          <tbody>
            {rows.map((player, index) => (
              <tr key={`${statKey}-${player.id || index}`}>
                <td className="font-display text-lg font-bold">{index + 1}</td>
                <td>
                  <div className="flex flex-col">
                    <span className="font-semibold">{player.name}</span>
                    <span className="text-sm text-mut">{player.club}</span>
                  </div>
                </td>
                <td className="text-right font-display text-xl font-bold">{player[statKey] || 0}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

export function Leaderboard() {
  const { seasonScope } = useLeague();
  const { data: apiResponse, loading, error, retry } = useApi('/leaderboard');

  const topScorers = apiResponse?.data?.topScorers || [];
  const topAssists = apiResponse?.data?.topAssists || [];
  const divisionName = seasonScope.divisionRecord?.name;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 bg-bg px-4 py-8 text-ink">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-bold">
          {divisionName ? `${divisionName}${seasonScope.season && seasonScope.seasons.length > 1 ? ` ${seasonScope.season.name}` : ''} ` : ''}Player stats
        </h1>
      </header>

      {loading && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}
      {!loading && error && <ErrorState title="Could not load player stats" message={error.message} onRetry={retry} />}
      {!loading && !error && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <StatTable caption="Top scorers" label="Goals" rows={topScorers.map((p) => ({ ...p, stat: p.goalsScored }))} statKey="goalsScored" />
          <StatTable caption="Top assists" label="Assists" rows={topAssists.map((p) => ({ ...p, stat: p.assists }))} statKey="assists" />
        </div>
      )}
    </div>
  );
}
