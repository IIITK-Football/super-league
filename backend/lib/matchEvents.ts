// Pure helpers for the live scoring route: validating an event from a request, parsing minutes, and planning the
// "+1" / "-1" score steps as event changes (D-08). Nothing here touches the network or the database.
export const EVENT_KINDS = ['goal', 'own_goal', 'yellow', 'red'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type EventRow = {
  id?: string;
  match_id?: string;
  kind?: EventKind;
  team_id?: string;
  player_id?: string | null;
  assist_player_id?: string | null;
  minute?: number | null;
  added_minute?: number | null;
  voided_at?: string | null;
};
type MatchTeams = { home_team_id: string; away_team_id: string };
export type ParseResult = { ok: true; event: EventRow & { id: string } } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "45", 45, "45'" or "45+2" -> { minute, added }; anything else -> null values (an unknown minute is allowed). */
export function parseMinute(value: unknown): { minute: number | null; added: number | null } {
  if (value === null || value === undefined || value === '') return { minute: null, added: null };
  const text = String(value).trim();
  const m = text.match(/^(\d{1,3})\s*(?:\+\s*(\d{1,2}))?\s*'?$/);
  if (!m) return { minute: null, added: null };
  const minute = Number(m[1]);
  const added = m[2] === undefined ? null : Number(m[2]);
  return { minute: minute <= 150 ? minute : null, added: added !== null && added <= 30 ? added : null };
}

/**
 * Validates an event from a request. `partial` (edits) keeps only the fields that were sent; a full event (adds) needs
 * a kind and a team in the match, and a player for a card. The database repeats every rule; this gives clear messages.
 */
export function parseEventInput(input: any, match: MatchTeams, opts: { partial?: boolean } = {}): ParseResult {
  if (input === null || typeof input !== 'object') return { ok: false, message: 'An event is required.' };
  const out: EventRow & { id: string } = { id: input.id ?? (globalThis.crypto?.randomUUID?.() as string) };
  if (input.id !== undefined && !UUID.test(String(input.id))) return { ok: false, message: 'The event id must be a UUID.' };
  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;

  if (has('kind') || !opts.partial) {
    if (!EVENT_KINDS.includes(input.kind)) return { ok: false, message: `Choose an event kind: ${EVENT_KINDS.join(', ')}.` };
    out.kind = input.kind;
  }
  if (has('team_id') || !opts.partial) {
    if (![match.home_team_id, match.away_team_id].includes(input.team_id)) return { ok: false, message: 'The team is not playing in this match.' };
    out.team_id = input.team_id;
  }
  for (const key of ['player_id', 'assist_player_id'] as const) {
    if (has(key)) {
      if (input[key] !== null && !UUID.test(String(input[key]))) return { ok: false, message: `${key} must be a player id or null.` };
      out[key] = input[key];
    }
  }
  if (has('minute')) {
    const { minute, added } = parseMinute(input.minute);
    out.minute = minute;
    if (!has('added_minute')) out.added_minute = added;
  }
  if (has('added_minute')) {
    const n = input.added_minute === null ? null : Number(input.added_minute);
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > 30)) return { ok: false, message: 'Added time must be 0 to 30 minutes.' };
    out.added_minute = n;
  }
  const kind = out.kind ?? input.kind;
  if (!opts.partial && (kind === 'yellow' || kind === 'red') && !out.player_id) return { ok: false, message: 'A card needs a player.' };
  if (out.assist_player_id && out.assist_player_id === (out.player_id ?? null)) return { ok: false, message: 'The assisting player cannot be the scorer.' };
  if (out.assist_player_id && kind && kind !== 'goal') return { ok: false, message: 'Only a goal has an assist.' };
  return { ok: true, event: out };
}

export type StepPlan =
  | { ok: true; action: 'add'; team_id: string }
  | { ok: true; action: 'void'; event_id: string }
  | { ok: true; action: 'choose'; candidates: EventRow[] }
  | { ok: false; message: string };

/** Which team's goal events score for a side: its goals, and the other team's own goals. */
export const scoresFor = (e: EventRow, sideTeam: string, otherTeam: string) =>
  (e.kind === 'goal' && e.team_id === sideTeam) || (e.kind === 'own_goal' && e.team_id === otherTeam);

/**
 * "+1" adds an unattributed goal for the side. "-1" voids the newest unattributed goal for that side; when every goal
 * has a scorer nothing is removed silently: the scorer chooses from the candidates (the goals that count for the side).
 */
export function planScoreStep(events: EventRow[], match: MatchTeams, side: unknown, delta: unknown): StepPlan {
  if (side !== 'home' && side !== 'away') return { ok: false, message: 'side must be home or away.' };
  if (delta !== 1 && delta !== -1) return { ok: false, message: 'delta must be 1 or -1.' };
  const team = side === 'home' ? match.home_team_id : match.away_team_id;
  const other = side === 'home' ? match.away_team_id : match.home_team_id;
  if (delta === 1) return { ok: true, action: 'add', team_id: team };
  const live = events.filter((e) => !e.voided_at);
  const unattributed = live.filter((e) => e.kind === 'goal' && e.team_id === team && !e.player_id);
  if (unattributed.length) {
    const newest = [...unattributed].sort((a: any, b: any) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0];
    return { ok: true, action: 'void', event_id: newest.id as string };
  }
  const candidates = live.filter((e) => scoresFor(e, team, other));
  if (!candidates.length) return { ok: false, message: 'There is no goal to remove for that side.' };
  return { ok: true, action: 'choose', candidates };
}
