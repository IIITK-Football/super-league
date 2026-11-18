// Arguments for the captain_update_roster_player RPC. A captain may change only the allow-listed fields of an
// existing player on their own team in that season (SL-003): position and jersey number on the season roster place,
// and overall rating, attributes (including the play style) and portrait on the player's card. The RPC takes no
// name, email, account link or roster argument, so none can be sent from here.
export function rosterPlayerRpcArgs(player, attributes, randomRating) {
  return {
    p_membership_id: player.id,
    p_position: player.position || null,
    p_jersey_number: Number(player.jerseyNumber) || null,
    p_overall_rating: Number(player.overallRating) || randomRating(),
    p_attributes: attributes,
    p_image_url: player.imageUrl || null,
  };
}
