// Fantasy points from match events (D-08). Grading and regrading run in the database (grade_match and
// regrade_all_predictions, migration 20261205000002); this module computes the same points for the history breakdown,
// and a test checks that the two agree. The scoreline comes from the match's score columns (a cache of its events or an awarded
// result); player points come from attributed goal events and their assisters. Unattributed goals count toward the
// scoreline only. Grading overwrites points_awarded and records the events version it graded at, so repeating it gives
// the same points and a later correction shows as "needs regrade".
export type ActualPlayers = { scorers: string[]; assists: string[] };
export type GradeableMatch = { id: string; home_score: number | null; away_score: number | null; status: string; events_version: number };
type MatchEventRow = { kind: string; player_id: string | null; assist_player_id: string | null; voided_at?: string | null };

export const SCORER_POINTS = 100;
export const ASSIST_POINTS = 50;

/** The scorers and assisters of a match, one entry per goal: attributed, non-voided goal events only. */
export function actualPlayers(events: MatchEventRow[]): ActualPlayers {
  const live = events.filter((e) => !e.voided_at && e.kind === 'goal');
  return {
    scorers: live.map((e) => e.player_id).filter((id): id is string => Boolean(id)),
    assists: live.map((e) => e.assist_player_id).filter((id): id is string => Boolean(id)),
  };
}

export function frequencyMap(items: string[] | null | undefined): Record<string, number> {
  const map: Record<string, number> = {};
  for (const item of items ?? []) map[item] = (map[item] ?? 0) + 1;
  return map;
}

/** Hits between predicted and actual players: the lower of the two counts per player. */
export function playerHits(predicted: string[] | null | undefined, actual: string[] | null | undefined): number {
  if (!Array.isArray(predicted)) return 0;
  const pred = frequencyMap(predicted);
  const act = frequencyMap(actual);
  let hits = 0;
  for (const [id, n] of Object.entries(pred)) if (act[id]) hits += Math.min(n, act[id]);
  return hits;
}

export function scorelinePoints(predHome: number, predAway: number, actHome: number, actAway: number): number {
  if (predHome === actHome && predAway === actAway) return 300;
  let points = 0;
  const predDiff = predHome - predAway;
  const actDiff = actHome - actAway;
  if ((predDiff > 0 && actDiff > 0) || (predDiff < 0 && actDiff < 0) || (predDiff === 0 && actDiff === 0)) points += 100;
  points -= (Math.abs(predHome - actHome) + Math.abs(predAway - actAway)) * 10;
  return points;
}

export function predictionPoints(
  prediction: { predicted_home_score: number; predicted_away_score: number; predicted_scorers?: string[] | null; predicted_assists?: string[] | null },
  match: { home_score: number | null; away_score: number | null },
  actual: ActualPlayers,
): number {
  return (
    scorelinePoints(prediction.predicted_home_score, prediction.predicted_away_score, match.home_score ?? 0, match.away_score ?? 0) +
    playerHits(prediction.predicted_scorers, actual.scorers) * SCORER_POINTS +
    playerHits(prediction.predicted_assists, actual.assists) * ASSIST_POINTS
  );
}
