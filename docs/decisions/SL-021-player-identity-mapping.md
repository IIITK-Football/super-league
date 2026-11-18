# SL-021: Player identity and season roster mapping

**Status:** Decided by the owner on 2026-11-18 (full port; FUT card on the identity; ambiguous matches stop; the team builder wins on a merged pair; goals and assists are season-specific). Implemented in `20261124000000_player_identity_rosters.sql` (expand) and `20261125000000_retire_team_bound_rosters.sql` (contract). It refines the `players` + `team_members` row of `SL-004-migration-and-cutover-strategy.md` §2.

## Model

| Fact | Lives in | Notes |
|---|---|---|
| Player identity (the reusable FUT card): name, portrait, overall rating, attributes, play styles | `players` | Same ids as before, so goals, match JSON, predictions and links stay valid. |
| A player on a team for one season: team entry, jersey number, position | `roster_memberships` | One team per player per season; a jersey number is unique within a team entry. |
| Contact email (protected identity data) | `player_private_details` | Dictators only. Never in a public read. The account link is SL-042. |
| Goals and assists | Match events (`goals`, match JSON), read through `season_player_stats` | Never stored on the identity or the roster place. Cross-season figures are sums of season lines. |
| How each Freshers member became a player | `legacy_roster_map` | Dictators only; kept as the record of the migration. |
| The retired cross-season counter `players.assists` | `legacy_player_assist_counts` | Dictators only; the match-event work (SL-022) reconciles it and drops it. |

## Mapping of existing data

**Players.** Every player keeps its row and id. A player with a season roster place (`players.team_entry_id`) gets one roster membership on that team entry, carrying its jersey number and position. A player without a team keeps no roster place (as before).

**Freshers members (`team_members`).** Each member's registration names a team and a season; that team's entry for the season is created if missing. A registration without a team stops the migration. For each member, the normalized name is used: `lower`, trimmed, whitespace collapsed, `first_name last_name`, else `name`. It is compared with the players on that team entry.

| Candidates | Outcome |
|---|---|
| Exactly one, claimed by no other member | **Linked** to that player. The team-builder values win where they are set: jersey number, position, overall rating, attributes, portrait and email. Every replaced player value is recorded in `legacy_roster_map.overwritten`. |
| None | **Created**: a new player that reuses the member's id, so no reference to it changes, and a roster membership. |
| More than one, or several members on one player | **The migration stops**, lists the rows and changes nothing. They are resolved by hand first (SL-004: never auto-merge silently). |

A jersey collision on a team after the merge also stops the migration.

**References.** A linked member's id in `matches.scorers`, `assists`, `own_goals` (id strings or `{"player_id"}` objects) and in `predictions.predicted_scorers` and `predicted_assists` is rewritten to the player's id. Guards check that the number of entries, the goals and the awarded prediction points are unchanged, and that no reference to a linked member is left.

**Retirement.** The contract migration runs only if every member is mapped, every player with a team has its roster place, the counter snapshot is complete, and no reference to a linked member is left. It drops `team_members`, `players.team_id`, `team_entry_id`, `position`, `jersey_number`, `assists`, `unique_team_jersey` and both `captain_update_team_member` overloads.

## Access

- **Public:** player cards (`players`) and roster places of visible seasons (`roster_memberships`).
- **Dictators only:** all writes, and reads of private details, the mapping and the snapshot. Players are created on a roster through `create_rostered_player`.
- **Captains:** `captain_update_roster_player` only. It needs the captain role and the team's registration for that season (SL-003 rule 3), and the season must be current (`20261127000000`): the card is shared by every season, so an earlier season's assignment must not reach a player who moved on. It writes only position and jersey on the roster place, and rating, attributes/play styles and portrait on the card. There is no name, email, link or roster argument, and no direct write path.
- **History is kept on every path:**
  - deleting a player who scored or assisted is refused (`goals` foreign keys are RESTRICT);
  - a roster place with goals or assists in that season cannot be removed (trigger `roster_memberships_keep_history`);
  - a player on any roster cannot be deleted.

## Season statistics until the match-event work

A match records goals in two places until SL-022: the `goals` table and the match JSON. Freshers goals scored by members were recorded only in the JSON, because their `goals` rows failed the players key. `season_player_stats` counts, per match and player, the greater of the two. So the usual duplicated record counts once, a JSON-only goal is no longer lost, and every page and viewer gets the same numbers. SL-022 replaces both sources with canonical events and keeps the view's interface.

## Production

Before the `main` release, the owner runs `scripts/sql/roster-mapping-dryrun.sql` on a **local restore** of production (never against hosted from this repository). It lists blockers, each member's predicted outcome with the values the team builder would replace, and the references to rewrite. The migration itself stops on any blocker. `pnpm db:rehearse-rosters --yes` rehearses both migrations locally on the pre-SL-021 schema, the old seed and edge-case fixtures, including the stop path.
