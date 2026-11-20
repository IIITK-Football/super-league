import { isResponse, jsonError, requireUser, UUID } from '@/lib/roster/access';
import { myRoles } from '@/lib/auth/roles';
import { ImageError, portraitKey, readPortrait, uploadPortrait } from '@/lib/roster/playerImage';

export const runtime = 'nodejs';

// A captain (or a dictator) uploads the portrait for a player on their team's roster: multipart
// { membership_id, image }.
// The same rule as captain_update_roster_player applies: the captain grant AND a writable captain assignment on the
// place's team entry, or the dictator role. The upload returns the URL; the team builder then saves it on the player's card
// through the captain RPC. The key is the player's id, never an email.
export async function POST(request: Request) {
  try {
    const caller = await requireUser(request);
    if (isResponse(caller)) return caller;
    const { supabase } = caller;

    const form = await request.formData();
    const membershipId = String(form.get('membership_id') || '');
    if (!UUID.test(membershipId)) return jsonError('Choose a player on your roster.', 400);

    const { data: place, error: placeError } = await supabase
      .from('roster_memberships')
      .select('player_id, team_entry_id')
      .eq('id', membershipId)
      .maybeSingle();
    if (placeError) throw placeError;

    // A dictator, or the captain holding the captain grant and a writable assignment (current or upcoming season,
    // not completed or archived) on this exact team entry. The portrait belongs to the player's shared card.
    const roles = await myRoles(supabase);
    let allowed = roles.includes('dictator');
    if (!allowed && place) {
      const { data: isCaptain, error: captainError } = await supabase.rpc('is_captain_of', { p_entry: place.team_entry_id });
      if (captainError) throw captainError;
      allowed = isCaptain === true;
    }
    // A missing roster place and someone else's give the same answer.
    if (!place || !allowed) return jsonError('Only the captain of this player\'s team, or a dictator, can upload this portrait.', 403);

    const image = await readPortrait(form);
    if (!image) return jsonError('Choose a 500 x 500 PNG image.', 400);
    const imageUrl = await uploadPortrait(portraitKey(place.player_id), image);
    return Response.json({ success: true, imageUrl });
  } catch (error) {
    if (error instanceof ImageError) return jsonError(error.message, error.status);
    console.error('Player image upload failed:', error);
    return Response.json({ success: false, message: 'The player image could not be uploaded.' }, { status: 500 });
  }
}
