// @vitest-environment jsdom
// Group: frontend-components. The captain's team builder shows exactly the roster places of the team entry they are assigned to in
// that assignment's season (never another team's, another season's, or a stale earlier answer), names the team by
// the team record, keeps empty card values empty (no generated stats or rating), and saves only changed players'
// allow-listed fields through captain_update_roster_player. It never shows or sends a player's private email. Against an in-memory Data API fake; the real
// path is TeamBuilder.local.test.jsx (rosters group).
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = { tables: {}, rpcError: null, rosterError: null, slowEntry: null };
const auth = { roles: ['captain'] };
const rpc = vi.fn(async () => ({ data: null, error: db.rpcError }));

function seed({ roster = true, pastSeason = false } = {}) {
  db.tables = {
    divisions: [{ id: 'd1', name: 'Freshers', sort_order: 1 }, { id: 'd2', name: 'Empty Division', sort_order: 2 }],
    seasons: [{ id: 's1', division_id: 'd1', name: '2026', is_current: true, sort_order: 2 }, { id: 's0', division_id: 'd1', name: '2025', is_current: false, sort_order: 1 }],
    // A captain's assignments, each with its team entry and season (the team record is what is shown).
    captain_assignments: [
      { id: 'r1', user_id: 'c1', team_entry: { id: 'e1', team_id: 't1', season_id: 's1', season: { id: 's1', name: '2026', is_current: true, status: 'active', archived_at: null, division: { id: 'd1', name: 'Freshers' } } } },
      { id: 'r2', user_id: 'c2', team_entry: { id: 'e2', team_id: 't2', season_id: 's1', season: { id: 's1', name: '2026', is_current: true, status: 'active', archived_at: null, division: { id: 'd1', name: 'Freshers' } } } },
      ...(pastSeason ? [{ id: 'r0', user_id: 'c1', team_entry: { id: 'e0', team_id: 't1', season_id: 's0', season: { id: 's0', name: '2025', is_current: false, status: 'completed', archived_at: null, division: { id: 'd1', name: 'Freshers' } } } }] : []),
    ],
    teams: [{ id: 't1', name: 'Alpha', logo_url: 'https://img/alpha.png', team_color: '#112233' }, { id: 't2', name: 'Beta', logo_url: null, team_color: null }],
    team_entries: [{ id: 'e1', team_id: 't1', season_id: 's1' }, { id: 'e2', team_id: 't2', season_id: 's1' }, { id: 'e0', team_id: 't1', season_id: 's0' }],
    // (e0 is Alpha's earlier season)
    roster_memberships: [
      ...(roster ? [
        { id: 'm1', team_entry_id: 'e1', jersey_number: 9, position: 'ST', player: { id: 'p1', first_name: 'Ada', last_name: 'Striker', image_url: null, overall_rating: 70, attributes: {} } },
        { id: 'm2', team_entry_id: 'e1', jersey_number: 1, position: 'GK', player: { id: 'p2', first_name: 'Bea', last_name: 'Keeper', image_url: null, overall_rating: 65, attributes: { stats: { Pace: { total: 81, sprint: 79 } }, bio: { preferredFoot: 'Left' }, playStyle: 'Power Shot', extra: 1 } } },
      ] : []),
      // Another team's player in the same season, and the same team's player in an earlier season.
      { id: 'm-other-team', team_entry_id: 'e2', jersey_number: 7, position: 'CM', player: { id: 'p3', first_name: 'Wrong', last_name: 'Team', image_url: null, overall_rating: 60, attributes: {} } },
      { id: 'm-old-season', team_entry_id: 'e0', jersey_number: 4, position: 'CB', player: { id: 'p4', first_name: 'Wrong', last_name: 'Season', image_url: null, overall_rating: 60, attributes: {} } },
    ],
  };
  db.rpcError = null;
  db.rosterError = null;
  db.slowEntry = null;
  auth.roles = ['captain'];
}

function from(table) {
  const filters = [];
  const ins = [];
  let single = false;
  const rows = () => db.tables[table].filter((r) => filters.every(([c, v]) => r[c] === v) && ins.every(([c, vs]) => vs.includes(r[c])));
  const b = {
    select: () => b, order: () => b,
    eq: (c, v) => { filters.push([c, v]); return b; },
    in: (c, vs) => { ins.push([c, vs]); return b; },
    maybeSingle: () => { single = true; return b; },
    then: (resolve, reject) => {
      const slow = table === 'roster_memberships' && db.slowEntry && filters.some(([c, v]) => c === 'team_entry_id' && v === db.slowEntry);
      return (slow ? new Promise((r) => setTimeout(r, 60)) : Promise.resolve()).then(() => {
        if (table === 'roster_memberships' && db.rosterError) return { data: null, error: db.rosterError };
        // The captain's own assignments only, as row level security returns them.
        const visible = table === 'captain_assignments' && !auth.roles.includes('dictator') ? rows().filter((r) => r.user_id === 'c1') : rows();
        return { data: single ? visible[0] ?? null : visible, error: null };
      }).then(resolve, reject);
    },
  };
  return b;
}

vi.mock('../../lib/supabase', () => ({ supabase: { from: (t) => from(t), rpc: (...a) => rpc(...a), auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'c1' }, roles: auth.roles, hasRole: (r) => auth.roles.includes(r) }) }));

import { TeamBuilder, attributesForSave, fromMember } from '../TeamBuilder';
import { ConfirmProvider } from '../../components/ui/ConfirmProvider';

beforeEach(() => { seed(); rpc.mockClear(); });
afterEach(cleanup);

const renderBuilder = () => render(<ConfirmProvider><MemoryRouter><TeamBuilder /></MemoryRouter></ConfirmProvider>);

describe('TeamBuilder on season rosters', () => {
  it('shows the captain\'s season roster from roster places, without any private email', async () => {
    renderBuilder();
    expect(await screen.findByRole('button', { name: /01 Ada Striker/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /02 Bea Keeper/ })).toBeTruthy();
    expect(screen.queryByText(/email/i)).toBeNull();
    expect(screen.getByText('#9 · ST')).toBeTruthy();
  });

  it('shows only the assigned team\'s roster for the registration\'s season, named by the team record', async () => {
    renderBuilder();
    await screen.findByRole('button', { name: /01 Ada Striker/ });
    expect(screen.getAllByRole('button', { name: /^0\d / }).map((b) => b.textContent)).toEqual(['01 Ada Striker', '02 Bea Keeper']);
    expect(screen.queryByText(/Wrong Team|Wrong Season/)).toBeNull();
    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0);
    expect(screen.queryByText('Old Copy Name')).toBeNull();
  });

  it('saves allow-listed fields for each roster place through the captain RPC', async () => {
    renderBuilder();
    await screen.findByRole('button', { name: /01 Ada Striker/ });
    fireEvent.change(screen.getByLabelText(/jersey number/i), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/overall rating/i), { target: { value: '81' } });
    fireEvent.click(screen.getByRole('button', { name: /save player profiles/i }));
    await waitFor(() => expect(screen.getByText(/Saved \d players?\./)).toBeTruthy());
    expect(rpc).toHaveBeenCalledTimes(1); // only the changed player is saved; the unedited one is not rewritten
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe('captain_update_roster_player');
    expect(args).toMatchObject({ p_membership_id: 'm1', p_position: 'ST', p_jersey_number: 10, p_overall_rating: 81, p_image_url: null, p_attributes: {} });
    expect(Object.keys(args).sort()).toEqual(['p_attributes', 'p_image_url', 'p_jersey_number', 'p_membership_id', 'p_overall_rating', 'p_position']);
  });

  it('shows the database\'s refusal instead of claiming success', async () => {
    db.rpcError = { message: 'Player is not part of your assigned roster' };
    renderBuilder();
    await screen.findByRole('button', { name: /01 Ada Striker/ });
    fireEvent.change(screen.getByLabelText(/jersey number/i), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /save player profiles/i }));
    await waitFor(() => expect(screen.getByText(/not part of your assigned roster/)).toBeTruthy());
    expect(screen.queryByText(/Saved \d players?\./)).toBeNull();
  });

  it('shows a pending roster when the team has no players this season', async () => {
    seed({ roster: false });
    renderBuilder();
    expect(await screen.findByText(/forming the player roster/i)).toBeTruthy();
  });

  it('keeps empty card values empty after loading and saving, and keeps the values that exist', async () => {
    renderBuilder();
    await screen.findByRole('button', { name: /01 Ada Striker/ });
    fireEvent.click(screen.getByRole('tab', { name: 'Attributes' }));
    for (const stat of ['Pace', 'Shooting', 'Passing', 'Dribbling', 'Defending', 'Physicality']) expect(screen.getByLabelText(stat).value).toBe('');
    fireEvent.click(screen.getByRole('tab', { name: /play style/i }));
    expect(screen.getByLabelText(/preferred foot/i).value).toBe('');
    fireEvent.click(screen.getByRole('tab', { name: /details/i }));
    fireEvent.change(screen.getByLabelText(/jersey number/i), { target: { value: '11' } });
    fireEvent.click(screen.getByRole('button', { name: /save player profiles/i }));
    await waitFor(() => expect(screen.getByText(/Saved \d players?\./)).toBeTruthy());
    expect(rpc.mock.calls[0][1].p_attributes).toEqual({}); // still no stats, foot or play style
    expect(rpc.mock.calls[0][1].p_overall_rating).toBe(70);
    fireEvent.click(screen.getByRole('tab', { name: 'Attributes' }));
    expect(screen.getByLabelText('Pace').value).toBe('');
  });

  it('round-trips an existing card unchanged except for the edited value', () => {
    const bea = fromMember({ id: 'm2', first_name: 'Bea', last_name: 'Keeper', overall_rating: 65, attributes: db.tables.roster_memberships[1].player.attributes });
    expect(bea.stats.Pace).toBe('81');
    expect(bea.preferredFoot).toBe('Left');
    expect(attributesForSave(bea).value).toEqual(db.tables.roster_memberships[1].player.attributes);
    expect(attributesForSave({ ...bea, stats: { ...bea.stats, Shooting: '70' } }).value).toEqual({
      stats: { Pace: { total: 81, sprint: 79 }, Shooting: { total: 70 } }, bio: { preferredFoot: 'Left' },
      playStyle: 'Power Shot', extra: 1,
    });
  });

  it('saves with the rating not set instead of inventing one', async () => {
    db.tables.roster_memberships[0].player.overall_rating = null;
    renderBuilder();
    await screen.findByRole('button', { name: /01 Ada Striker/ });
    expect(screen.getByLabelText(/overall rating/i).value).toBe('');
    fireEvent.change(screen.getByLabelText(/jersey number/i), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: /save player profiles/i }));
    await waitFor(() => expect(screen.getByText(/Saved \d players?\./)).toBeTruthy());
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_membership_id: 'm1', p_jersey_number: 12, p_overall_rating: null });
  });

  it('lets a captain with several teams switch between them, and opens a past season read-only', async () => {
    seed({ pastSeason: true });
    renderBuilder();
    await screen.findByRole('button', { name: /01 Ada Striker/ });
    const mine = screen.getByLabelText('Your team');
    expect(within(mine).getAllByRole('option').map((o) => o.textContent)).toEqual(['Alpha · Freshers 2026', 'Alpha · Freshers 2025 (past season, read only)']);
    fireEvent.change(mine, { target: { value: 'r0' } });
    expect(await screen.findByText(/past season: captains can view it but not change it/i)).toBeTruthy();
  });

  it('shows an error, not someone else\'s players, when the roster cannot be loaded', async () => {
    db.rosterError = { message: 'permission denied for table roster_memberships' };
    renderBuilder();
    expect(await screen.findByText(/The roster could not be loaded: permission denied/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^0\d / })).toBeNull();
  });

  it('a dictator who also captains a team starts on it and can edit (no read-only preview)', async () => {
    auth.roles = ['dictator'];
    renderBuilder();
    await screen.findByRole('button', { name: /01 Ada Striker/ });
    expect(screen.getByLabelText('Team').value).toBe('t1');
    expect(screen.getByText(/Dictator workspace/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/jersey number/i), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: /save player profiles/i }));
    await waitFor(() => expect(screen.getByText(/Saved \d players?\./)).toBeTruthy());
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_membership_id: 'm1', p_jersey_number: 15 });
  });

  it('a dictator picks division, season and team and edits any roster', async () => {
    auth.roles = ['dictator'];
    db.tables.captain_assignments = db.tables.captain_assignments.filter((r) => r.user_id !== 'c1'); // not a captain
    renderBuilder();
    expect(await screen.findByText(/Pick a division, season and team/)).toBeTruthy();
    expect(screen.getByLabelText('Season').disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Division'), { target: { value: 'd2' } });
    expect(await screen.findByRole('option', { name: 'This division has no seasons' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Division'), { target: { value: 'd1' } });
    await waitFor(() => expect(screen.getByRole('option', { name: '2026 (current)' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Season'), { target: { value: 's1' } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Beta' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Team'), { target: { value: 't2' } });
    expect(await screen.findByRole('button', { name: /01 Wrong Team/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Ada Striker/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /change logo/i })).toBeNull(); // branding stays with the team's captain
    fireEvent.change(screen.getByLabelText(/jersey number/i), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: /save player profiles/i }));
    await waitFor(() => expect(screen.getByText(/Saved \d players?\./)).toBeTruthy());
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_membership_id: 'm-other-team', p_jersey_number: 8 });
  });

  it('a dictator\'s late roster answer for a previously chosen team is ignored', async () => {
    auth.roles = ['dictator'];
    renderBuilder();
    await screen.findByRole('button', { name: /01 Ada Striker/ });
    db.slowEntry = 'e2'; // Beta's roster answers late
    fireEvent.change(screen.getByLabelText('Team'), { target: { value: 't2' } });
    fireEvent.change(screen.getByLabelText('Team'), { target: { value: 't1' } });
    expect(await screen.findByRole('button', { name: /01 Ada Striker/ })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 120));
    expect(screen.queryByRole('button', { name: /Wrong Team/ })).toBeNull();
  });

  it('a captain whose team has no roster yet can still edit the team\'s details', async () => {
    seed({ roster: false });
    renderBuilder();
    expect(await screen.findByText(/forming the player roster/i)).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /edit team details/i }));
    expect((await screen.findByLabelText('Team name')).value).toBe('Alpha');
    expect(screen.getByLabelText('Short name')).toBeTruthy();
  });
});

describe('TeamBuilder checks before and after saving', () => {
  it('blocks a save with no position and names the player, without calling the database', async () => {
    renderBuilder();
    await screen.findByRole('button', { name: /01 Ada Striker/ });
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save player profiles/i }));
    expect(await screen.findByText('Choose a position for Ada Striker before saving.')).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('keeps earlier players saved and says how many saved before a failure', async () => {
    renderBuilder();
    await screen.findByRole('button', { name: /01 Ada Striker/ });
    fireEvent.change(screen.getByLabelText(/jersey number/i), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /02 Bea Keeper/ }));
    fireEvent.change(screen.getByLabelText(/jersey number/i), { target: { value: '2' } });
    rpc.mockImplementationOnce(async () => ({ data: null, error: null }));
    rpc.mockImplementationOnce(async () => ({ data: null, error: { message: 'permission denied' } }));
    fireEvent.click(screen.getByRole('button', { name: /save player profiles/i }));
    expect(await screen.findByText('Saved 1 of 2, failed at Bea Keeper: permission denied')).toBeTruthy();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('says how many changes are unsaved next to the save button', async () => {
    renderBuilder();
    await screen.findByRole('button', { name: /01 Ada Striker/ });
    expect(screen.getByText('No unsaved changes')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/jersey number/i), { target: { value: '10' } });
    expect(screen.getByText('1 unsaved change')).toBeTruthy();
  });

  it('refuses a blank team name before saving the team details', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderBuilder();
    await screen.findByRole('button', { name: /01 Ada Striker/ });
    fireEvent.click(screen.getByRole('button', { name: /edit team details/i }));
    fireEvent.change(await screen.findByLabelText('Team name'), { target: { value: ' ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save team details' }));
    expect(await screen.findByText('Enter a team name of 2 to 60 characters.')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('asks before Escape discards unsaved team details', async () => {
    renderBuilder();
    await screen.findByRole('button', { name: /01 Ada Striker/ });
    fireEvent.click(screen.getByRole('button', { name: /edit team details/i }));
    fireEvent.change(await screen.findByLabelText('Team name'), { target: { value: 'Alpha Two' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(await screen.findByText('Discard team details?')).toBeTruthy();
    expect(screen.getByLabelText('Team name').value).toBe('Alpha Two');
  });

  it('rejects a logo that is not a PNG before it is kept', async () => {
    renderBuilder();
    await screen.findByRole('button', { name: /01 Ada Striker/ });
    fireEvent.click(screen.getByRole('button', { name: /edit team details/i }));
    const input = await screen.findByLabelText('Team logo');
    fireEvent.change(input, { target: { files: [new File(['x'], 'logo.jpg', { type: 'image/jpeg' })] } });
    expect(await screen.findByText('Club logo must be a PNG file.')).toBeTruthy();
  });

  it('starts the team colour unset for a captain who has not chosen one', async () => {
    db.tables.captain_assignments = [{ ...db.tables.captain_assignments[1], user_id: 'c1' }]; // Beta only: no logo, no colour
    renderBuilder();
    await screen.findByText(/Set up Beta/);
    expect(screen.getByText('Not set. Pick a colour.')).toBeTruthy();
  });
});
