import { Link, useNavigate } from 'react-router-dom';
import { useLeague } from '../context/LeagueContext';
import { useApi } from '../hooks/useApi';
import { SeasonSelect } from '../components/SeasonSelect';
import { MatchStrip } from '../components/match/MatchStrip';
import { pickHeroMatch } from '../components/match/matchState';
import { StandingsTable } from '../components/standings/StandingsTable';
import { Card, EmptyState, ErrorState, Pill, Skeleton } from '../components/ui';

const HERO_LABEL = { live: 'Live now', next: 'Next match', result: 'Latest result' };

// The team object of a match, with its crest taken from the table (the schedule does not carry logos).
const withLogo = (team, teamId, logos) => ({ ...(Array.isArray(team) ? team[0] : team), logo_url: logos.get(teamId) ?? null });

function SectionHead({ title, to, action }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="font-display text-2xl font-bold text-ink">{title}</h2>
      {to && <Link to={to} className="inline-flex min-h-11 items-center text-sm font-semibold text-mut hover:text-ink">{action}</Link>}
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading this division" className="space-y-10">
      <Skeleton className="h-12 w-72" />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="space-y-6">
          <Skeleton className="h-44 w-full" />
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        </div>
        <div className="space-y-6">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      </div>
    </div>
  );
}

// The division's front page. Opens on the live match, else the next one, else the latest result. Every module
// hides when it has no data; nothing here is a placeholder.
export function Home() {
  const { division, seasonScope } = useLeague();
  const navigate = useNavigate();
  // Requests wait for the chosen season; an unknown season is reported below and nothing is requested.
  const board = useApi(seasonScope.seasonMissing ? null : '/standings');
  const extras = useApi(seasonScope.seasonMissing ? null : '/home/dashboard');

  // Choosing a season puts it in the address (/wsl/2027), so the page can be shared; the current season is plain /wsl.
  const chooseSeason = (slug) => {
    const current = seasonScope.currentSeason;
    navigate(slug === current?.slug ? `/${division}` : `/${division}/${slug}`);
  };

  if (seasonScope.seasonMissing) {
    return (
      <div className="flex min-h-[50vh] flex-col items-start justify-center gap-3">
        <h1 className="font-display text-3xl font-bold text-ink">Season not found</h1>
        <p className="text-mut">There is no season &quot;{seasonScope.requestedSeasonSlug}&quot; in {seasonScope.divisionRecord?.name || 'this division'}.</p>
        <Link to={`/${division}`} className="inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-4">
          Go to the current season
        </Link>
      </div>
    );
  }

  const divisionName = seasonScope.divisionRecord?.name;
  const season = seasonScope.season;
  const header = (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1">
        <h1 className="font-display text-4xl font-bold text-ink sm:text-5xl">{divisionName || ' '}</h1>
        {season && <p className="text-mut">{season.name} season</p>}
      </div>
      {seasonScope.seasons.length > 1 && (
        <SeasonSelect seasons={seasonScope.seasons} value={season?.slug} onChange={chooseSeason} />
      )}
    </div>
  );

  if (!seasonScope.ready || board.loading) {
    return <div className="space-y-10 pb-12">{header}<HomeSkeleton /></div>;
  }

  if (board.error) {
    return (
      <div className="space-y-10 pb-12">
        {header}
        <ErrorState message={board.error.message} onRetry={board.retry} />
      </div>
    );
  }

  const payload = board.data?.data ?? {};
  const table = payload.standings ?? [];
  const logos = new Map(table.map((row) => [row.teamId, row.logoUrl]));
  const matches = (payload.bracketMatches ?? []).map((m) => ({
    ...m,
    home: withLogo(m.home, m.home_team_id, logos),
    away: withLogo(m.away, m.away_team_id, logos),
  }));
  const hero = pickHeroMatch(matches);

  const extraData = extras.data?.data ?? {};
  const news = (extraData.news ?? []).slice(0, 3);
  const leaders = [
    extraData.topScorer && { key: 'scorer', label: 'Top scorer', unit: 'goals', player: extraData.topScorer },
    extraData.topAssist && { key: 'assist', label: 'Top assists', unit: 'assists', player: extraData.topAssist },
  ].filter(Boolean);
  const predictions = extraData.fantasyTop ?? [];

  const nothingYet = !hero && table.length === 0 && !extras.loading && !extras.error
    && news.length === 0 && leaders.length === 0 && predictions.length === 0;

  return (
    <div className="space-y-10 pb-12">
      {header}

      {nothingYet && (
        <EmptyState title="Nothing published for this season yet">
          Matches, the table, news and predictions appear here as they are added.
        </EmptyState>
      )}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="min-w-0 space-y-10">
          {hero && (
            <section aria-label={HERO_LABEL[hero.kind]} className="space-y-3">
              <p className="text-sm font-semibold text-mut">{HERO_LABEL[hero.kind]}</p>
              <MatchStrip match={hero.match} featured />
            </section>
          )}

          {table.length > 0 && (
            <section className="space-y-3">
              <SectionHead title="Table" to={`/standings/${division}`} action="Full table" />
              <StandingsTable rows={table.slice(0, 5)} caption="Top of the table" />
            </section>
          )}
        </div>

        <div className="min-w-0 space-y-10">
          {extras.error && (
            <ErrorState
              title="News, stats and predictions did not load"
              message={extras.error.message}
              onRetry={extras.retry}
            />
          )}

          {leaders.length > 0 && (
            <section className="space-y-3">
              <SectionHead title="Player stats" to="/leaderboard" action="All player stats" />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                {leaders.map(({ key, label, unit, player }) => (
                  <Card key={key} className="space-y-3">
                    <p className="text-sm font-semibold text-mut">{label}</p>
                    {player.playerId
                      ? <Link to={`/teams?player=${player.playerId}`} className="block min-h-11 rounded-ctl hover:text-mut"><span className="font-display text-2xl font-bold text-ink">{player.name}</span></Link>
                      : <span className="font-display text-2xl font-bold text-ink">{player.name}</span>}
                    <p className="flex items-baseline gap-2">
                      <span className="font-display text-5xl font-bold tabular-nums text-ink">{player.stat}</span>
                      <span className="text-sm text-mut">{unit}{player.club ? ` · ${player.club}` : ''}</span>
                    </p>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {news.length > 0 && (
            <section className="space-y-3">
              <SectionHead title="News" to={`/${division}/news`} action="All news" />
              <ul className="divide-y divide-line rounded-card border border-line bg-surf">
                {news.map((article) => (
                  <li key={article.id}>
                    <Link to={`/article/${article.id}`} className="block min-h-11 px-4 py-3 hover:bg-raise sm:px-5">
                      <span className="line-clamp-2 font-semibold leading-snug text-ink">{article.headline || article.title}</span>
                      {article.date && (
                        <span className="mt-1 block text-sm text-mut">
                          {new Date(article.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {predictions.length > 0 && (
            <section className="space-y-3">
              <SectionHead title="Predictions" to="/fantasy" action="Prediction table" />
              <ol className="divide-y divide-line rounded-card border border-line bg-surf">
                {predictions.map((user, index) => (
                  <li key={user.id} className="flex min-h-11 items-center justify-between gap-3 px-4 py-3 sm:px-5">
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="w-5 shrink-0 font-display text-lg font-bold tabular-nums text-mut">{index + 1}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-ink">{user.name}</span>
                        {user.flair && <Pill className="mt-1">{user.flair}</Pill>}
                      </span>
                    </span>
                    <span className="shrink-0 font-display text-2xl font-bold tabular-nums text-ink">{user.points.toLocaleString()}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
