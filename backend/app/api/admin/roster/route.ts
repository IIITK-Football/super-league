import { NextResponse } from 'next/server';
import { handleError } from '../../../../lib/errorHandler';
import { UUID, dbErrorResponse, isResponse, jsonError, requireDictator } from '@/lib/roster/access';

// Dictator roster management: a roster place puts a player on a team entry (a team in one season) with that
// season's jersey number and position. A player is on at most one team per season. Every query runs as the caller,
// so row level security enforces the dictator role on each write.

function jersey(value: unknown): number | null | string {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 99 ? n : 'Jersey number must be between 0 and 99.';
}

function position(value: unknown): string | null | { error: string } {
  if (value === undefined || value === null) return null;
  const p = String(value).trim();
  if (p.length > 50) return { error: 'The position can have up to 50 characters.' };
  return p || null;
}

// ADD an existing player to a season roster: { player_id, team_entry_id, jersey_number?, position? }
export async function POST(request: Request) {
  try {
    const caller = await requireDictator(request);
    if (isResponse(caller)) return caller;
    const body = await request.json();
    if (!UUID.test(String(body.player_id ?? '')) || !UUID.test(String(body.team_entry_id ?? ''))) {
      return jsonError('Choose a player and a team.', 400);
    }
    const j = jersey(body.jersey_number);
    if (typeof j === 'string') return jsonError(j, 400);
    const p = position(body.position);
    if (p && typeof p === 'object') return jsonError(p.error, 400);

    const { data: entry, error: entryError } = await caller.supabase.from('team_entries').select('id, season_id').eq('id', body.team_entry_id).maybeSingle();
    if (entryError) throw entryError;
    if (!entry) return jsonError('Team entry not found.', 404);

    const { data, error } = await caller.supabase
      .from('roster_memberships')
      .insert({ player_id: body.player_id, team_entry_id: entry.id, season_id: entry.season_id, jersey_number: j, position: p })
      .select('id')
      .single();
    const refused = dbErrorResponse(error);
    if (refused) return refused;
    if (error) throw error;
    return NextResponse.json({ success: true, message: 'Player added to the roster.', data }, { status: 201 });
  } catch (error) {
    return handleError(error, 'Admin Add Roster Place');
  }
}

// CHANGE a roster place: { membership_id, jersey_number?, position?, team_entry_id? }. Moving a player changes
// their team within the same season only (a different season is a new roster place).
export async function PATCH(request: Request) {
  try {
    const caller = await requireDictator(request);
    if (isResponse(caller)) return caller;
    const body = await request.json();
    if (!UUID.test(String(body.membership_id ?? ''))) return jsonError('Choose a roster place.', 400);

    const { data: place, error: placeError } = await caller.supabase.from('roster_memberships').select('id, season_id').eq('id', body.membership_id).maybeSingle();
    if (placeError) throw placeError;
    if (!place) return jsonError('Roster place not found.', 404);

    const update: Record<string, unknown> = {};
    if ('jersey_number' in body) {
      const j = jersey(body.jersey_number);
      if (typeof j === 'string') return jsonError(j, 400);
      update.jersey_number = j;
    }
    if ('position' in body) {
      const p = position(body.position);
      if (p && typeof p === 'object') return jsonError(p.error, 400);
      update.position = p;
    }
    if (body.team_entry_id !== undefined) {
      if (!UUID.test(String(body.team_entry_id))) return jsonError('Choose a team.', 400);
      const { data: entry, error: entryError } = await caller.supabase.from('team_entries').select('id, season_id').eq('id', body.team_entry_id).maybeSingle();
      if (entryError) throw entryError;
      if (!entry) return jsonError('Team entry not found.', 404);
      if (entry.season_id !== place.season_id) return jsonError('A player can move only to a team in the same season.', 400);
      update.team_entry_id = entry.id;
    }
    if (!Object.keys(update).length) return jsonError('Nothing to change.', 400);

    const { data, error } = await caller.supabase.from('roster_memberships').update(update).eq('id', place.id).select('id');
    const refused = dbErrorResponse(error);
    if (refused) return refused;
    if (error) throw error;
    if (!data?.length) return jsonError('Roster place not found.', 404);
    return NextResponse.json({ success: true, message: 'Roster place updated.' });
  } catch (error) {
    return handleError(error, 'Admin Update Roster Place');
  }
}

// REMOVE a player from a season roster (?membership_id=). The player stays; a roster place is history once the
// player has goals or assists in that season, so it is kept.
export async function DELETE(request: Request) {
  try {
    const caller = await requireDictator(request);
    if (isResponse(caller)) return caller;
    const id = new URL(request.url).searchParams.get('membership_id') ?? '';
    if (!UUID.test(id)) return jsonError('Choose a roster place.', 400);

    const { data: place, error: placeError } = await caller.supabase.from('roster_memberships').select('id, player_id, season_id').eq('id', id).maybeSingle();
    if (placeError) throw placeError;
    if (!place) return jsonError('Roster place not found.', 404);
    const { count, error: statsError } = await caller.supabase
      .from('season_player_stats')
      .select('player_id', { count: 'exact', head: true })
      .eq('player_id', place.player_id)
      .eq('season_id', place.season_id);
    if (statsError) throw statsError;
    if ((count ?? 0) > 0) return jsonError('This player has goals or assists this season, so their place on the roster is kept.', 409);

    const { data, error } = await caller.supabase.from('roster_memberships').delete().eq('id', id).select('id');
    const refused = dbErrorResponse(error);
    if (refused) return refused;
    if (error) throw error;
    if (!data?.length) return jsonError('Roster place not found.', 404);
    return NextResponse.json({ success: true, message: 'Player removed from the roster.' });
  } catch (error) {
    return handleError(error, 'Admin Remove Roster Place');
  }
}
