import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { EmptyState, ErrorState, Skeleton, buttonClasses } from './ui';
import { HeroMatch } from './match/HeroMatch';

// Events in match order: by minute, then by added time (45+2 comes before 46).
export function sortEvents(events) {
  return [...events].sort((a, b) => ((a.minute ?? 0) - (b.minute ?? 0)) || ((a.added_minute ?? 0) - (b.added_minute ?? 0)));
}

const minuteText = (event) => `${event.minute ?? '?'}${event.added_minute ? `+${event.added_minute}` : ''}`;
const minuteLabel = (event) => `${minuteText(event)}'`;

// The score after each goal. A card changes nothing. An own goal scores for the other side.
function withRunningScore(events, homeTeamId) {
  let home = 0;
  let away = 0;
  return events.map((event) => {
    if (event.isCard) return { ...event, runningHome: home, runningAway: away };
    const forHome = (event.team_id === homeTeamId) !== event.is_own_goal;
    if (forHome) home += 1;
    else away += 1;
    return { ...event, runningHome: home, runningAway: away };
  });
}

// True when the event counts for the home side. A goal is for the side that scored it, except an own goal.
function isHomeSide(event, match) {
  return event.isCard ? event.team_id === match.home_team_id : (event.team_id === match.home_team_id) !== event.is_own_goal;
}

export default function MatchTimeline() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState({ loading: true, error: '', match: null, events: [] });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState((s) => ({ ...s, loading: true, error: '' }));
      try {
        const { data: match, error: matchError } = await supabase
          .from('matches')
          .select('id, season_id, status, date, venue, home_score, away_score, minute, result_kind, result_reason, home_team_id, away_team_id, home:teams!home_team_id(name, logo_url), away:teams!away_team_id(name, logo_url), season:seasons!inner(section_flags, division:divisions!inner(id))')
          .eq('id', id)
          .eq('season.visibility', 'public').is('season.archived_at', null)
          .eq('season.division.visibility', 'public').is('season.division.archived_at', null)
          .maybeSingle();
        if (matchError) throw matchError;
        if (!match || !match.season?.section_flags?.fixtures) {
          if (!cancelled) setState({ loading: false, error: '', match: null, events: [] });
          return;
        }

        // Goals, own goals and cards; a voided event is a correction and is never shown.
        const { data: rawEvents, error: eventsError } = await supabase
          .from('match_events')
          .select('id, team_id, kind, player_id, assist_player_id, minute, added_minute')
          .eq('match_id', id)
          .is('voided_at', null);
        if (eventsError) throw eventsError;

        // Names, numbers and positions of the players in this match (a roster place in the match's season).
        const ids = [...new Set((rawEvents || []).flatMap((e) => [e.player_id, e.assist_player_id]).filter(Boolean))];
        const [{ data: people }, { data: places }] = ids.length
          ? await Promise.all([
            supabase.from('players').select('id, first_name, last_name').in('id', ids),
            supabase.from('roster_memberships').select('player_id, jersey_number, position').in('player_id', ids).eq('season_id', match.season_id ?? ''),
          ])
          : [{ data: [] }, { data: [] }];
        const placeOf = new Map((places || []).map((r) => [r.player_id, r]));
        const nameOf = new Map((people || []).map((p) => [p.id, `${p.first_name} ${p.last_name}`]));
        const numberOf = (playerId) => placeOf.get(playerId)?.jersey_number ?? '-';

        const events = sortEvents(rawEvents || []).map((e) => ({
          ...e,
          isCard: e.kind === 'yellow' || e.kind === 'red',
          is_own_goal: e.kind === 'own_goal',
          playerName: e.player_id ? nameOf.get(e.player_id) ?? 'Unknown player' : 'Scorer not recorded',
          playerNumber: numberOf(e.player_id),
          playerPosition: placeOf.get(e.player_id)?.position || '',
          assistName: e.assist_player_id ? nameOf.get(e.assist_player_id) ?? 'Unknown player' : null,
          assistNumber: numberOf(e.assist_player_id),
        }));

        if (!cancelled) setState({ loading: false, error: '', match, events: withRunningScore(events, match.home_team_id) });
      } catch {
        if (!cancelled) setState({ loading: false, error: 'The match could not be loaded.', match: null, events: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [id, attempt]);

  // Back returns to the page the visitor came from; a match opened directly goes to the matches list.
  const back = () => (location.key !== 'default' ? navigate(-1) : navigate('/matches'));
  const backLink = (
    <button type="button" onClick={back} className={buttonClasses('quiet', 'sm', 'px-0')}>Back</button>
  );

  if (state.loading) {
    return (
      <div aria-busy="true" aria-label="Loading the match" className="space-y-6 pb-12">
        {backLink}
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="space-y-6 pb-12">
        {backLink}
        <ErrorState message={state.error} onRetry={() => setAttempt((n) => n + 1)} />
      </div>
    );
  }

  if (!state.match) {
    return (
      <div className="space-y-6 pb-12">
        {backLink}
        <EmptyState title="Match not found">
          This match does not exist, or it was removed. <Link className="font-semibold text-ink underline underline-offset-4" to="/matches">See all matches</Link>
        </EmptyState>
      </div>
    );
  }

  const { match, events } = state;
  const homeName = match.home?.name || 'To be confirmed';
  const awayName = match.away?.name || 'To be confirmed';
  const awarded = match.result_kind && match.result_kind !== 'played';
  const date = match.date ? new Date(match.date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : null;
  // The scorers under each side of the header. An own goal is listed under the side it helps.
  const scorer = (event) => ({ name: event.playerName, minute: minuteText(event), isOwnGoal: event.is_own_goal });
  const goals = events.filter((e) => !e.isCard);
  const detail = {
    homeScorers: goals.filter((e) => isHomeSide(e, match)).map(scorer),
    awayScorers: goals.filter((e) => !isHomeSide(e, match)).map(scorer),
  };

  return (
    <div className="space-y-12 pb-12">
      {backLink}

      <div className="space-y-4">
        <HeroMatch match={match} detail={detail} />
        <p className="eyebrow flex flex-wrap gap-x-4 gap-y-1">
          {date && <span>{date}</span>}
          {match.venue && <span>{match.venue}</span>}
          {awarded && <span title={match.result_reason || ''}>{match.result_kind} awarded{match.result_reason ? `: ${match.result_reason}` : ''}</span>}
        </p>
      </div>

      <section aria-labelledby="events-heading" className="space-y-5">
        <h2 id="events-heading" className="font-display text-3xl text-ink sm:text-4xl">Timeline</h2>
        {events.length === 0 ? (
          <EmptyState title={awarded ? `Result awarded: ${match.result_reason || match.result_kind}` : 'No events yet'}>
            {awarded ? null : 'Goals and cards appear here as they are recorded.'}
          </EmptyState>
        ) : (
          <ol className="glass divide-y divide-line/70 overflow-hidden rounded-card">
            {events.map((event) => {
              const home = isHomeSide(event, match);
              const teamName = event.team_id === match.home_team_id ? homeName : awayName;
              const card = event.isCard;
              const body = (
                <span className={`flex min-w-0 flex-col gap-0.5 ${home ? 'sm:items-end sm:text-right' : ''}`}>
                  <span className={`flex max-w-full items-center gap-2 font-black uppercase tracking-tight text-ink ${home ? 'sm:flex-row-reverse' : ''}`}>
                    {card && <span aria-hidden="true" className={`h-4 w-3 shrink-0 rounded-sm ${event.kind === 'red' ? 'bg-live' : 'bg-ink/70'}`} />}
                    <span className="truncate">{event.playerName}</span>
                  </span>
                  <span className="eyebrow">
                    {card ? (event.kind === 'red' ? 'Red card' : 'Yellow card') : event.is_own_goal ? 'Own goal' : 'Goal'}
                  </span>
                  <span className="text-sm text-mut">
                    {teamName}{event.playerPosition ? ` · ${event.playerPosition}` : ''}{event.playerNumber !== '-' ? ` #${event.playerNumber}` : ''}
                    {event.assistName ? ` · Assist: ${event.assistName}` : ''}
                  </span>
                </span>
              );
              return (
                <li
                  key={event.id}
                  className="flex items-center gap-4 px-4 py-4 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:gap-6 sm:px-6"
                  data-testid={card ? 'timeline-card' : undefined}
                >
                  <span className={home ? 'flex min-w-0 flex-1 sm:flex-none' : 'hidden sm:block'}>{home && body}</span>
                  <span className="order-first flex w-16 shrink-0 flex-col items-center gap-1 text-center sm:order-none sm:w-auto">
                    <span className="font-display text-3xl leading-none tabular-nums text-ink">{minuteLabel(event)}</span>
                    {!card && <span className="font-display text-sm tabular-nums text-mut">{event.runningHome}–{event.runningAway}</span>}
                  </span>
                  <span className={home ? 'hidden sm:block' : 'flex min-w-0 flex-1 sm:flex-none'}>{!home && body}</span>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
