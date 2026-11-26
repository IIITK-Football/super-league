import { useEffect, useState } from 'react';
import { useLeague } from '../context/LeagueContext';
import { supabase } from '../lib/supabase';
import { EmptyState, ErrorState, Skeleton } from '../components/ui';
import { MatchList } from '../components/match/MatchList';
import { isFinal, isLive, isUpcoming } from '../components/match/matchState';

const byDate = (order) => (a, b) => order * (new Date(a.date || 0) - new Date(b.date || 0));

// Live matches first, then upcoming fixtures soonest first, then results latest first. Each part is grouped by day.
export function Matches() {
  const { seasonScope } = useLeague();
  const seasonId = seasonScope.season?.id;
  const [state, setState] = useState({ loading: true, error: '', matches: [] });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!seasonScope.ready) return undefined;
    if (!seasonId) {
      setState({ loading: false, error: '', matches: [] });
      return undefined;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: '' }));
    supabase
      .from('matches')
      .select('id, status, date, venue, home_score, away_score, minute, home:teams!home_team_id(name, logo_url), away:teams!away_team_id(name, logo_url)')
      .eq('season_id', seasonId)
      .order('date', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        setState(error
          ? { loading: false, error: 'The matches could not be loaded.', matches: [] }
          : { loading: false, error: '', matches: data || [] });
      });
    return () => { cancelled = true; };
  }, [seasonScope.ready, seasonId, attempt]);

  const header = (
    <header className="space-y-1">
      <h1 className="font-display text-4xl font-bold text-ink sm:text-5xl">Matches</h1>
      <p className="text-mut">
        {[seasonScope.divisionRecord?.name, seasonScope.season?.name].filter(Boolean).join(' · ') || ' '}
      </p>
    </header>
  );

  if (state.loading) {
    return (
      <div aria-busy="true" aria-label="Loading matches" className="space-y-6 pb-12">
        {header}
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28 w-full" />)}
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="space-y-6 pb-12">
        {header}
        <ErrorState message={state.error} onRetry={() => setAttempt((n) => n + 1)} />
      </div>
    );
  }

  const { matches } = state;
  if (matches.length === 0) {
    return (
      <div className="space-y-6 pb-12">
        {header}
        <EmptyState title={`No matches in ${seasonScope.season?.name ?? 'this season'} yet`}>
          Fixtures appear here once they are scheduled.
        </EmptyState>
      </div>
    );
  }

  const live = matches.filter(isLive).sort(byDate(1));
  const upcoming = matches.filter(isUpcoming).sort(byDate(1));
  const results = matches.filter(isFinal).sort(byDate(-1));

  return (
    <div className="space-y-12 pb-12">
      {header}
      {live.length > 0 && (
        <section aria-labelledby="live-heading" className="space-y-4">
          <h2 id="live-heading" className="font-display text-2xl font-bold text-ink">Live now</h2>
          <MatchList matches={live} />
        </section>
      )}
      {upcoming.length > 0 && (
        <section aria-labelledby="upcoming-heading" className="space-y-4">
          <h2 id="upcoming-heading" className="font-display text-2xl font-bold text-ink">Upcoming</h2>
          <MatchList matches={upcoming} />
        </section>
      )}
      {results.length > 0 && (
        <section aria-labelledby="results-heading" className="space-y-4">
          <h2 id="results-heading" className="font-display text-2xl font-bold text-ink">Results</h2>
          <MatchList matches={results} />
        </section>
      )}
    </div>
  );
}
