import { NextResponse } from 'next/server';
import { isResponse, jsonError, requireUser, UUID } from '@/lib/roster/access';
import { ImageError, portraitKey, readPortrait, uploadPortrait } from '@/lib/roster/playerImage';

export const runtime = 'nodejs';

// A captain (or a dictator) uploads the portrait for a player on their roster: multipart { membership_id, image }.
// The same rule as captain_update_roster_player applies: the captain role AND the team's registration for that
// season, or the dictator role. The upload returns the URL; the team builder then saves it on the player's card
// through the captain RPC. The key is the player's id, never an email.
export async function POST(request: Request) {
  try {
    const caller = await requireUser(request);
    if (isResponse(caller)) return caller;
    const { supabase, user } = caller;

    const form = await request.formData();
    const membershipId = String(form.get('membership_id') || '');
    if (!UUID.test(membershipId)) return jsonError('Choose a player on your roster.', 400);

    const { data: place, error: placeError } = await supabase
      .from('roster_memberships')
      .select('player_id, season_id, entry:team_entries ( team_id )')
      .eq('id', membershipId)
      .maybeSingle();
    if (placeError) throw placeError;
    const teamId = (place?.entry as { team_id?: string } | null)?.team_id;

    const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', user.id);
    const held = new Set((roles ?? []).map((r) => r.role));
    let allowed = held.has('dictator');
    if (!allowed && place && teamId && held.has('captain')) {
      const { data: registration } = await supabase
        .from('team_registrations')
        .select('id')
        .eq('captain_id', user.id)
        .eq('team_id', teamId)
        .eq('season_id', place.season_id)
        .maybeSingle();
      allowed = Boolean(registration);
    }
    // A missing roster place and someone else's give the same answer.
    if (!place || !allowed) return jsonError('Only the captain of this player\'s team, or a dictator, can upload this portrait.', 403);

    const image = await readPortrait(form);
    if (!image) return jsonError('Choose a 500 x 500 PNG image.', 400);
    const imageUrl = await uploadPortrait(portraitKey(place.player_id), image);
    return NextResponse.json({ success: true, imageUrl });
  } catch (error) {
    if (error instanceof ImageError) return jsonError(error.message, error.status);
    console.error('Player image upload failed:', error);
    return NextResponse.json({ success: false, message: 'The player image could not be uploaded.' }, { status: 500 });
  }
}
