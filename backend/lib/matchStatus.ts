// Match statuses: the one list every route filters and branches on. 'live' is in play; 'completed' and
// 'forfeited' are final results (forfeits are awarded, never played).
export const MATCH_STATUS = {
  scheduled: 'scheduled',
  live: 'live',
  completed: 'completed',
  forfeited: 'forfeited',
} as const;

export type MatchStatus = (typeof MATCH_STATUS)[keyof typeof MATCH_STATUS];

// Not yet finished: the schedule's upcoming and live list.
export const OPEN_STATUSES: MatchStatus[] = [MATCH_STATUS.scheduled, MATCH_STATUS.live];

// Final results that count toward standings and form.
export const FINAL_STATUSES: MatchStatus[] = [MATCH_STATUS.completed, MATCH_STATUS.forfeited];
