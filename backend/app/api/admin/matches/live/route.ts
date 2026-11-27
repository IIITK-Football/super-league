import { handleError } from '../../../../../lib/errorHandler';
import { callerClient } from '@/lib/roster/access';
import { planScoreStep, parseEventInput, parseMinute, EVENT_KINDS, type EventRow } from '@/lib/matchEvents';

// Live scoring on match events (D-08). Events are what happened; the score is a cache the database recomputes from
// the non-voided events in the same transaction, so the route never writes a score. Authorization: a dictator or a
// scorer assigned to the match (can_score), and every write runs as the caller, so row level security says the same.
//
// Actions (POST { match_id, action, ... }):
//   add_event    { event: { id?, kind, team_id, player_id?, assist_player_id?, minute?, added_minute? } }
//                idempotent on id: a replay returns the stored event, different content for the same id is a 409
//   edit_event   { event_id, version, changes: { kind?, team_id?, player_id?, assist_player_id?, minute?, added_minute? } }
//                the version is the one the client last saw; a mismatch is a 409 with the current event
//   void_event   { event_id, version, reason }   removal is voiding: the event stays, with who and why
//   score_step   { side: 'home' | 'away', delta: 1 | -1 }   +1 adds an unattributed goal; -1 voids the newest
//                unattributed goal of that side, or answers 409 with the goals to choose from
//   update_time, half_time, close_match   the clock and status
const fail = (status: number, message: string, extra: Record<string, unknown> = {}) => Response.json({ success: false, message, ...extra }, { status });

function mapDbError(error: { code?: string; message?: string }) {
  if (error.code === '42501') return fail(403, 'Forbidden: you are not assigned to score this match.');
  if (error.code === '23505') return fail(409, 'That event id is already used.');
  if (error.code === '23514' || error.code === '23503' || error.code === '22P02' || error.code === '22003') {
    const message = error.message ?? 'The event is not valid.';
    return fail(/voided|awarded/i.test(message) ? 409 : 400, message);
  }
  return null;
}

const EVENT_COLUMNS = 'id, match_id, team_id, kind, player_id, assist_player_id, minute, added_minute, version, source, created_at, updated_at, voided_at, void_reason';

async function currentMatch(supabase: any, matchId: string) {
  const { data } = await supabase.from('matches').select('id, home_team_id, away_team_id, home_score, away_score, status, minute, events_version, result_kind').eq('id', matchId).maybeSingle();
  return data;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { match_id, action } = body;
    if (!match_id || !action) throw { status: 400, message: 'match_id and action are required.' };

    const supabase = await callerClient(request);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw { status: 401, message: 'Unauthorized: Please log in.' };

    // A dictator, or a scorer with an unexpired assignment to this match or its season. A captain or a normal
    // account is refused, and the writes below also run as the caller, so row level security says the same.
    const { data: allowed, error: scoreErr } = await supabase.rpc('can_score', { p_match: match_id });
    if (scoreErr) throw { status: 500, message: 'Could not check scoring access.' };
    if (!allowed) throw { status: 403, message: 'Forbidden: you are not assigned to score this match.' };

    const match = await currentMatch(supabase, match_id);
    if (!match) throw { status: 404, message: 'Match not found.' };

    const done = async (message: string, extra: Record<string, unknown> = {}) => {
      const fresh = await currentMatch(supabase, match_id);
      return Response.json({ success: true, message, match: fresh, ...extra });
    };
    const markLive = async () => {
      if (match.status !== 'scheduled') return;
      const { error } = await supabase.from('matches').update({ status: 'live' }).eq('id', match_id);
      if (error) throw error;
    };

    switch (action) {
      case 'add_event': {
        const parsed = parseEventInput(body.event, match);
        if (!parsed.ok) throw { status: 400, message: parsed.message };
        const ev = parsed.event;
        const { data: existing } = await supabase.from('match_events').select(EVENT_COLUMNS).eq('id', ev.id).maybeSingle();
        if (existing) {
          const same = existing.match_id === match_id && existing.kind === ev.kind && existing.team_id === ev.team_id
            && (existing.player_id ?? null) === (ev.player_id ?? null) && (existing.assist_player_id ?? null) === (ev.assist_player_id ?? null)
            && (existing.minute ?? null) === (ev.minute ?? null);
          if (!same) return fail(409, 'That event id already holds a different event.', { event: existing });
          return Response.json({ success: true, message: 'Event already recorded.', replayed: true, event: existing, match: await currentMatch(supabase, match_id) });
        }
        const { data, error } = await supabase.from('match_events').insert({ ...ev, match_id }).select(EVENT_COLUMNS).single();
        if (error) return mapDbError(error) ?? Promise.reject(error);
        if (ev.kind === 'goal' || ev.kind === 'own_goal') await markLive();
        return done(ev.kind === 'yellow' || ev.kind === 'red' ? 'Card recorded.' : ev.player_id ? 'Goal recorded.' : 'Goal recorded; the scorer is not known yet.', { event: data });
      }

      case 'edit_event': {
        if (!body.event_id || !Number.isInteger(body.version)) throw { status: 400, message: 'event_id and the version you last saw are required.' };
        const parsed = parseEventInput({ ...(body.changes ?? {}), id: body.event_id }, match, { partial: true });
        if (!parsed.ok) throw { status: 400, message: parsed.message };
        const { id: _id, ...changes } = parsed.event as EventRow & { id: string };
        if (!Object.keys(changes).length) throw { status: 400, message: 'Nothing to change.' };
        const { data, error } = await supabase.from('match_events').update(changes).eq('id', body.event_id).eq('match_id', match_id).eq('version', body.version).select(EVENT_COLUMNS).maybeSingle();
        if (error) return mapDbError(error) ?? Promise.reject(error);
        if (!data) {
          const { data: cur } = await supabase.from('match_events').select(EVENT_COLUMNS).eq('id', body.event_id).eq('match_id', match_id).maybeSingle();
          if (!cur) throw { status: 404, message: 'Event not found.' };
          return fail(409, 'This event changed since you loaded it. Review the current version and try again.', { event: cur });
        }
        return done('Event updated.', { event: data });
      }

      case 'void_event': {
        if (!body.event_id || !Number.isInteger(body.version)) throw { status: 400, message: 'event_id and the version you last saw are required.' };
        const reason = String(body.reason ?? '').trim();
        if (!reason) throw { status: 400, message: 'A reason is required to void an event.' };
        const { data, error } = await supabase.from('match_events')
          .update({ voided_at: new Date().toISOString(), void_reason: reason })
          .eq('id', body.event_id).eq('match_id', match_id).eq('version', body.version).is('voided_at', null).select(EVENT_COLUMNS).maybeSingle();
        if (error) return mapDbError(error) ?? Promise.reject(error);
        if (!data) {
          const { data: cur } = await supabase.from('match_events').select(EVENT_COLUMNS).eq('id', body.event_id).eq('match_id', match_id).maybeSingle();
          if (!cur) throw { status: 404, message: 'Event not found.' };
          return fail(409, cur.voided_at ? 'This event is already voided.' : 'This event changed since you loaded it. Review the current version and try again.', { event: cur });
        }
        return done('Event voided and the score adjusted.', { event: data });
      }

      case 'score_step': {
        const { data: events } = await supabase.from('match_events').select(EVENT_COLUMNS).eq('match_id', match_id).is('voided_at', null);
        const plan = planScoreStep((events ?? []) as EventRow[], match, body.side, body.delta);
        if (!plan.ok) throw { status: 400, message: plan.message };
        if (plan.action === 'choose') {
          return fail(409, 'Every goal for that side has a scorer. Choose the goal to correct.', { candidates: plan.candidates });
        }
        if (plan.action === 'add') {
          const { data, error } = await supabase.from('match_events').insert({ id: body.id ?? crypto.randomUUID(), match_id, team_id: plan.team_id, kind: 'goal', minute: parseMinute(body.minute).minute }).select(EVENT_COLUMNS).single();
          if (error) return mapDbError(error) ?? Promise.reject(error);
          await markLive();
          return done('Goal added; the scorer is not known yet.', { event: data });
        }
        const { data, error } = await supabase.from('match_events')
          .update({ voided_at: new Date().toISOString(), void_reason: 'Score corrected (-1)' })
          .eq('id', plan.event_id).eq('match_id', match_id).is('voided_at', null).select(EVENT_COLUMNS).maybeSingle();
        if (error) return mapDbError(error) ?? Promise.reject(error);
        if (!data) return fail(409, 'That goal changed; try again.');
        return done('The unattributed goal was voided and the score adjusted.', { event: data });
      }

      case 'update_time': {
        const patch: Record<string, unknown> = { status: 'live' };
        if (body.minute !== undefined) patch.minute = body.minute;
        if (body.timer_start_time !== undefined) patch.timer_start_time = body.timer_start_time;
        if (body.timer_calibration !== undefined) patch.timer_calibration = body.timer_calibration;
        const { error } = await supabase.from('matches').update(patch).eq('id', match_id);
        if (error) return mapDbError(error) ?? Promise.reject(error);
        return done(`Match clock synced to ${body.minute}`);
      }

      case 'half_time': {
        const { error } = await supabase.from('matches').update({ status: 'live', minute: 'HT' }).eq('id', match_id);
        if (error) return mapDbError(error) ?? Promise.reject(error);
        return done('Match paused for Half Time!');
      }

      case 'close_match': {
        const patch: Record<string, unknown> = { status: 'completed', minute: 'FT' };
        if (body.home_penalties !== undefined && body.away_penalties !== undefined) {
          patch.home_penalties = body.home_penalties;
          patch.away_penalties = body.away_penalties;
        }
        const { error } = await supabase.from('matches').update(patch).eq('id', match_id);
        if (error) return mapDbError(error) ?? Promise.reject(error);
        return done('Match officially closed! Ready for grading.');
      }

      default:
        throw { status: 400, message: `Unknown action type. Use one of add_event, edit_event, void_event, score_step, update_time, half_time, close_match (event kinds: ${EVENT_KINDS.join(', ')}).` };
    }
  } catch (error) {
    return handleError(error, 'Live Match Update');
  }
}
