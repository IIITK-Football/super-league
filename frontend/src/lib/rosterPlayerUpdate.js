// Arguments for the captain_update_roster_player RPC. A captain may change only the allow-listed fields of an
// existing player on their own team in that season (SL-003): position and jersey number on the season roster place,
// and overall rating, attributes (including the play style) and portrait on the player's card. The RPC takes no
// name, email, account link or roster argument, so none can be sent from here.
export function rosterPlayerRpcArgs(player, attributes) {
  return {
    p_membership_id: player.id,
    p_position: player.position || null,
    // 0 is a valid jersey number; only an empty field means "none".
    p_jersey_number: player.jerseyNumber === '' || player.jerseyNumber === null || player.jerseyNumber === undefined ? null : Number(player.jerseyNumber),
    // No rating is ever generated: an empty one is sent as null, which the database refuses.
    p_overall_rating: player.overallRating === '' || player.overallRating == null ? null : Number(player.overallRating),
    p_attributes: attributes,
    p_image_url: player.imageUrl || null,
  };
}
