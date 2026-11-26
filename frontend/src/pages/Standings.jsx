import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLeague, scopeQuery } from '../context/LeagueContext';
import { useApi } from '../hooks/useApi';
import { StandingsTable } from '../components/standings/StandingsTable';
import { SeasonBracket, bracketRounds } from '../components/bracket/SeasonBracket';
import { MatchList } from '../components/match/MatchList';
import { EmptyState, ErrorState, Skeleton } from '../components/ui';

// Knockout bracket components used by the admin schedule preview. Both now read the season's knockout rounds.
// shortcut: the admin preview (components/admin/ScheduleMatches.jsx) still imports these names, to be switched to SeasonBracket.
export const WomensBracket = ({ matches = [] }) => <SeasonBracket matches={matches} />;
export const FreshersBracket = WomensBracket;

// Formats whose season is played as knockout matches. Without stage data they are listed as played, by date.
const KNOCKOUT_FORMATS = ['knockout', 'league_knockout'];
const byDateAscending = (a, b) => (new Date(a.date || 0) - new Date(b.date || 0));

// The division's league table and, when the season has knockout matches, its bracket. The division and season come
// from the address and the division's selected season.
export function Standings() {
  const { division: divisionParam } = useParams();
  const { setDivision, seasonScope } = useLeague();
  const division = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(divisionParam || '') ? divisionParam : 'super-league';

  useEffect(() => {
    setDivision(division);
  }, [division, setDivision]);

  // The selected season of this division (its current season unless another was chosen).
  const endpoint = seasonScope.ready && seasonScope.division === division ? `/standings?${scopeQuery(seasonScope)}` : null;
  const { data: apiResponse, loading, error, retry } = useApi(endpoint);

  if (seasonScope.ready && seasonScope.division === division && !seasonScope.divisionRecord) {
    // A failed lookup is not a missing division.
    if (seasonScope.error) return <ErrorState message="The division could not be loaded." />;
    return (
      <EmptyState title="Division not found">
        There is no division called &quot;{divisionParam}&quot;. <Link className="font-semibold text-ink underline underline-offset-4" to="/super-league">Go to Super League</Link>
      </EmptyState>
    );
  }

  const header = (
    <header className="space-y-1">
      <h1 className="font-display text-4xl font-bold text-ink sm:text-5xl">{seasonScope.divisionRecord?.name || ' '}</h1>
      <p className="text-mut">{seasonScope.season ? `${seasonScope.season.name} season · League table` : 'League table'}</p>
    </header>
  );

  if (loading || !endpoint) {
    return (
      <div aria-busy="true" aria-label="Loading the table" className="space-y-6 pb-12">
        {header}
        <div className="space-y-2">
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6 pb-12">
        {header}
        <ErrorState message={error.message} onRetry={retry} />
      </div>
    );
  }

  const standings = apiResponse?.data?.standings ?? [];
  const bracketMatches = apiResponse?.data?.bracketMatches ?? [];

  return (
    <div className="space-y-10 pb-12">
      {header}
      {standings.length === 0 ? (
        <EmptyState title="No table yet">The table appears here once teams are entered in this season.</EmptyState>
      ) : (
        <StandingsTable rows={standings} />
      )}
      <SeasonBracket matches={bracketMatches} />
      {bracketRounds(bracketMatches).length === 0 && KNOCKOUT_FORMATS.includes(seasonScope.season?.format) && bracketMatches.length > 0 && (
        <section aria-labelledby="knockout-heading" className="space-y-4">
          <h2 id="knockout-heading" className="font-display text-2xl font-bold text-ink">Knockout matches</h2>
          <MatchList matches={[...bracketMatches].sort(byDateAscending)} />
        </section>
      )}
    </div>
  );
}
