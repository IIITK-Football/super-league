// Shared fixture for the match-operations and fantasy integration tests (this repository's LOCAL stack only): the roles
// fixture's division with a current season, two teams and two matches, plus legacy players on each team's roster.
import { insertLocal } from '../local-fixtures';
import { account, cleanup as cleanupRoles, startFixture, world, type Roles } from '../roles/fixture';

export { account, startFixture, world };

export async function withPlayers(f: Roles, w: Awaited<ReturnType<typeof world>>, tag: string) {
  const players = insertLocal<{ id: string }>('players', [1, 2, 3, 4].map((n) => ({ first_name: `${tag}P${n}`, last_name: 'Player' })));
  insertLocal('roster_memberships', [
    { player_id: players[0].id, team_entry_id: w.entries.cur[0], season_id: w.seasons.cur, jersey_number: 1 },
    { player_id: players[1].id, team_entry_id: w.entries.cur[0], season_id: w.seasons.cur, jersey_number: 2 },
    { player_id: players[2].id, team_entry_id: w.entries.cur[1], season_id: w.seasons.cur, jersey_number: 1 },
    { player_id: players[3].id, team_entry_id: w.entries.cur[1], season_id: w.seasons.cur, jersey_number: 2 },
  ]);
  return { home: [players[0].id, players[1].id], away: [players[2].id, players[3].id], all: players.map((p) => p.id) };
}

export async function cleanup(f: Roles, playerIds: string[] = []) {
  if (f.admin) {
    // Matches first: a roster place with match history is kept, so it can only go once the events are gone.
    await f.admin.from('predictions').delete().in('match_id', f.made.matches);
    for (const id of f.made.matches) await f.admin.from('matches').delete().eq('id', id);
    await f.admin.from('roster_memberships').delete().in('player_id', playerIds);
  }
  await cleanupRoles(f);
  if (f.admin && playerIds.length) await f.admin.from('players').delete().in('id', playerIds);
}

export const uuid = () => crypto.randomUUID();
