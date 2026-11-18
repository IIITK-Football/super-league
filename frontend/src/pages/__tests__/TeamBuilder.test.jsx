// @vitest-environment jsdom
// Group: frontend-components. The captain's team builder reads the season roster of their registered team (roster
// places with the players' cards) and saves only allow-listed fields through captain_update_roster_player, one call
// per roster place. It never shows or sends a player's private email. Against an in-memory Data API fake; the real
// path is TeamBuilder.local.test.jsx (rosters group).
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = { tables: {}, rpcError: null };
const rpc = vi.fn(async () => ({ data: null, error: db.rpcError }));

function seed({ roster = true } = {}) {
  db.tables = {
    team_registrations: [{ id: 'r1', captain_id: 'c1', team_id: 't1', team_name: 'Alpha', season_id: 's1', season: { name: '2026', division: { name: 'Freshers' } } }],
    teams: [{ id: 't1', logo_url: 'https://img/alpha.png', team_color: '#112233' }],
    team_entries: [{ id: 'e1', team_id: 't1', season_id: 's1' }],
    roster_memberships: roster ? [
      { id: 'm1', team_entry_id: 'e1', jersey_number: 9, position: 'ST', player: { id: 'p1', first_name: 'Ada', last_name: 'Striker', image_url: null, overall_rating: 70, attributes: {} } },
      { id: 'm2', team_entry_id: 'e1', jersey_number: 1, position: 'GK', player: { id: 'p2', first_name: 'Bea', last_name: 'Keeper', image_url: null, overall_rating: 65, attributes: {} } },
    ] : [],
  };
  db.rpcError = null;
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
    then: (resolve, reject) => Promise.resolve().then(() => ({ data: single ? rows()[0] ?? null : rows(), error: null })).then(resolve, reject),
  };
  return b;
}

vi.mock('../../lib/supabase', () => ({ supabase: { from: (t) => from(t), rpc: (...a) => rpc(...a), auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'c1' }, role: 'captain' }) }));

import { TeamBuilder } from '../TeamBuilder';

beforeEach(() => { seed(); rpc.mockClear(); });
afterEach(cleanup);

const renderBuilder = () => render(<MemoryRouter><TeamBuilder /></MemoryRouter>);

describe('TeamBuilder on season rosters', () => {
  it('shows the captain\'s season roster from roster places, without any private email', async () => {
    renderBuilder();
    expect(await screen.findByRole('button', { name: /01 Ada Striker/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /02 Bea Keeper/ })).toBeTruthy();
    expect(screen.queryByText(/email/i)).toBeNull();
    expect(screen.getByText('#9 · ST')).toBeTruthy();
  });

  it('saves allow-listed fields for each roster place through the captain RPC', async () => {
    renderBuilder();
    await screen.findByRole('button', { name: /01 Ada Striker/ });
    fireEvent.change(screen.getByLabelText(/jersey number/i), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/overall rating/i), { target: { value: '81' } });
    fireEvent.click(screen.getByRole('button', { name: /save player profiles/i }));
    await waitFor(() => expect(screen.getByText(/saved successfully/i)).toBeTruthy());
    expect(rpc).toHaveBeenCalledTimes(2);
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe('captain_update_roster_player');
    expect(args).toMatchObject({ p_membership_id: 'm1', p_position: 'ST', p_jersey_number: 10, p_overall_rating: 81, p_image_url: null });
    expect(Object.keys(args).sort()).toEqual(['p_attributes', 'p_image_url', 'p_jersey_number', 'p_membership_id', 'p_overall_rating', 'p_position']);
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_membership_id: 'm2', p_position: 'GK', p_jersey_number: 1 });
  });

  it('shows the database\'s refusal instead of claiming success', async () => {
    db.rpcError = { message: 'Player is not part of your assigned roster' };
    renderBuilder();
    await screen.findByRole('button', { name: /01 Ada Striker/ });
    fireEvent.click(screen.getByRole('button', { name: /save player profiles/i }));
    await waitFor(() => expect(screen.getByText(/not part of your assigned roster/)).toBeTruthy());
    expect(screen.queryByText(/saved successfully/i)).toBeNull();
  });

  it('shows a pending roster when the team has no players this season', async () => {
    seed({ roster: false });
    renderBuilder();
    expect(await screen.findByText(/forming the player roster/i)).toBeTruthy();
  });
});
