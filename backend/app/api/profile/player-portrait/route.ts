import { isResponse, jsonError, requireUser } from '@/lib/roster/access';
import { ImageError, portraitKey, readPortrait, uploadPortrait } from '@/lib/roster/playerImage';

export const runtime = 'nodejs';

// A signed-in user uploads the portrait for the player linked to their own account: multipart { image }. The player is
// found by the database (my_player(), the caller's own link only), so nobody can upload for someone else's player. The
// upload returns the URL; the profile page then saves it through update_my_player, which accepts only this player's
// own picture. A new portrait goes live once saved and is recorded in the audit history.
export async function POST(request: Request) {
  try {
    const caller = await requireUser(request);
    if (isResponse(caller)) return caller;
    const { supabase } = caller;

    const { data: player, error } = await supabase.rpc('my_player');
    if (error) throw error;
    if (!player?.id) return jsonError('No player is linked to your account.', 403);

    const form = await request.formData();
    const image = await readPortrait(form);
    if (!image) return jsonError('Choose a 500 x 500 PNG image.', 400);
    const imageUrl = await uploadPortrait(portraitKey(player.id), image);
    return Response.json({ success: true, imageUrl });
  } catch (error) {
    if (error instanceof ImageError) return jsonError(error.message, error.status);
    console.error('Own portrait upload failed:', error);
    return Response.json({ success: false, message: 'Your portrait could not be uploaded.' }, { status: 500 });
  }
}
