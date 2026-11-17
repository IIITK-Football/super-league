// Arguments for the captain_update_team_member RPC. A captain may change only the presentation fields of an
// existing player (position, jersey number, overall rating, attributes including the play style, and the
// portrait). The email is a protected identity field, so it is never sent from here: a NULL email means "no
// change" to the database, which also refuses a captain who supplies a different one.
export function teamMemberRpcArgs(player, attributes, randomRating) {
  return {
    p_member_id: player.id,
    p_position: player.position || null,
    p_jersey_number: Number(player.jerseyNumber) || null,
    p_overall_rating: Number(player.overallRating) || randomRating(),
    p_attributes: attributes,
    p_email: null,
    p_image_url: player.imageUrl || null,
  };
}
