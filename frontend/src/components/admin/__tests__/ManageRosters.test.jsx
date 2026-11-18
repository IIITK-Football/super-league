// @vitest-environment jsdom
// Group: frontend-components. The dictator's Teams & Rosters flow against an in-memory Data API fake: loading,
// empty, success and error states; validation before any write; and the exact writes it sends (one reusable player
// card, one roster place per season). The real UI -> Data API -> database path is ManageRosters.local.test.jsx.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = { tables: {}, calls: [], fail: {} };
let nextId = 1;

function seed() {
  db.tables = {
    divisions: [{ id: 'd1', slug: 'wsl', name: 'WSL', sort_order: 1 }, { id: 'd2', slug: 'empty', name: 'Empty', sort_order: 2 }],
    seasons: [{ id: 's1', division_id: 'd1', slug: '2026', name: '2026', is_current: true, sort_order: 1 }],
    team_entries: [{ id: 'e1', team_id: 't1', season_id: 's1' }, { id: 'e2', team_id: 't2', season_id: 's1' }, { id: 'e0', team_id: 't3', season_id: 's0' }],
    teams: [{ id: 't1', name: 'Alpha' }, { id: 't2', name: 'Beta' }, { id: 't3', name: 'Gamma' }],
    roster_memberships: [{ id: 'm1', player_id: 'p1', team_entry_id: 'e1', season_id: 's1', jersey_number: 9, position: 'ST' }],
    players: [{ id: 'p1', first_name: 'Ada', last_name: 'Striker', image_url: null, overall_rating: 70, attributes: { pace: 80 } },
      { id: 'p2', first_name: 'Adam', last_name: 'Other', image_url: null, overall_rating: 60, attributes: {} }],
    player_private_details: [{ player_id: 'p1', email: 'ada@iiitkottayam.ac.in' }],
  };
  db.tables.seasons.push({ id: 's0', division_id: 'd1', slug: '2025', name: '2025', is_current: false, sort_order: 0 });
  db.calls = [];
  db.fail = {};
}

function from(table) {
  const q = { op: 'select', payload: null, filters: [], ins: [], single: false, opts: {} };
  const ok = (row) => q.filters.every(([c, v]) => row[c] === v) && q.ins.every(([c, vs]) => vs.includes(row[c]));
  const run = () => {
    db.calls.push({ table, op: q.op, payload: q.payload, filters: q.filters, opts: q.opts });
    const failure = db.fail[`${table}.${q.op}`];
    if (failure) return { data: null, error: failure };
    const rows = db.tables[table];
    if (q.op === 'select') {
      const data = rows.filter(ok).map((r) => ({ ...r }));
      return { data: q.single ? data[0] ?? null : data, error: null };
    }
    if (q.op === 'insert') {
      const added = (Array.isArray(q.payload) ? q.payload : [q.payload]).map((r) => ({ id: `new-${nextId++}`, ...r }));
      rows.push(...added);
      return { data: q.single ? added[0] : added, error: null };
    }
    if (q.op === 'update') {
      const changed = rows.filter(ok);
      changed.forEach((r) => Object.assign(r, q.payload));
      return { data: changed.map((r) => ({ id: r.id })), error: null };
    }
    if (q.op === 'delete') {
      const gone = rows.filter(ok);
      db.tables[table] = rows.filter((r) => !ok(r));
      return { data: gone.map((r) => ({ id: r.id })), error: null };
    }
    if (q.op === 'upsert') {
      const i = rows.findIndex((r) => r.player_id === q.payload.player_id);
      if (i >= 0) rows[i] = { ...rows[i], ...q.payload }; else rows.push({ ...q.payload });
      return { data: null, error: null };
    }
    return { data: null, error: null };
  };
  const b = {
    select: () => b,
    insert: (p) => Object.assign(q, { op: 'insert', payload: p }) && b,
    update: (p) => Object.assign(q, { op: 'update', payload: p }) && b,
    delete: () => Object.assign(q, { op: 'delete' }) && b,
    upsert: (p, o) => Object.assign(q, { op: 'upsert', payload: p, opts: o ?? {} }) && b,
    eq: (c, v) => { q.filters.push([c, v]); return b; },
    in: (c, vs) => { q.ins.push([c, vs]); return b; },
    or: (expr) => { q.or = expr; const term = expr.match(/ilike\.%(.*?)%/)?.[1]?.toLowerCase() ?? ''; q.filters.push(['__or', true]); q.matchName = term; return b; },
    order: () => b,
    limit: () => b,
    single: () => { q.single = true; return b; },
    then: (resolve, reject) => Promise.resolve().then(() => {
      if (q.matchName !== undefined) {
        q.filters = q.filters.filter(([c]) => c !== '__or');
        const data = db.tables[table].filter((r) => `${r.first_name} ${r.last_name}`.toLowerCase().includes(q.matchName));
        db.calls.push({ table, op: 'search', payload: q.or });
        return { data, error: null };
      }
      return run();
    }).then(resolve, reject),
  };
  return b;
}

const rpc = vi.fn(async (name, args) => {
  db.calls.push({ rpc: name, args });
  if (db.fail[`rpc.${name}`]) return { data: null, error: db.fail[`rpc.${name}`] };
  const id = `p-${nextId++}`;
  db.tables.players.push({ id, first_name: args.p_first_name, last_name: args.p_last_name, overall_rating: args.p_overall_rating, attributes: args.p_attributes });
  const entry = db.tables.team_entries.find((e) => e.id === args.p_team_entry_id);
  db.tables.roster_memberships.push({ id: `m-${nextId++}`, player_id: id, team_entry_id: entry.id, season_id: entry.season_id, jersey_number: args.p_jersey_number, position: args.p_position });
  return { data: id, error: null };
});

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: (t) => from(t), rpc: (...a) => rpc(...a), auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } },
}));

import ManageRosters, { describeError, parseAttributes, validatePlayer, blankPlayer } from '../ManageRosters';

beforeEach(() => { seed(); rpc.mockClear(); vi.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const writes = () => db.calls.filter((c) => c.rpc || ['insert', 'update', 'delete', 'upsert'].includes(c.op));
const pick = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

async function openTeam(team = 'e1') {
  render(<ManageRosters />);
  await waitFor(() => expect(screen.getByRole('option', { name: 'WSL' })).toBeTruthy());
  pick('Division', 'd1');
  await waitFor(() => expect(screen.getByRole('option', { name: '2026 (current)' })).toBeTruthy());
  pick('Season', 's1');
  await waitFor(() => expect(screen.getByRole('option', { name: 'Alpha' })).toBeTruthy());
  pick('Team', team);
}

describe('validation and messages', () => {
  it('validates a player before any write', () => {
    expect(validatePlayer({ ...blankPlayer(), first_name: ' ' }).error).toMatch(/first name/);
    expect(validatePlayer({ ...blankPlayer(), first_name: 'A', jersey_number: '120' }).error).toMatch(/0 and 99/);
    expect(validatePlayer({ ...blankPlayer(), first_name: 'A', overall_rating: '0' }).error).toMatch(/1 and 99/);
    expect(validatePlayer({ ...blankPlayer(), first_name: 'A', email: 'nope' }).error).toMatch(/valid email/);
    expect(validatePlayer({ ...blankPlayer(), first_name: 'A', attributesText: '[1]' }).error).toMatch(/JSON object/);
    expect(validatePlayer({ ...blankPlayer(), first_name: ' Ada ', last_name: 'S', jersey_number: '0', overall_rating: '80', email: 'A@X.IN', attributesText: '{"pace":9}' }).value)
      .toEqual({ first_name: 'Ada', last_name: 'S', jersey_number: 0, position: null, overall_rating: 80, attributes: { pace: 9 }, email: 'a@x.in' });
    expect(parseAttributes('').value).toEqual({});
  });

  it('turns database refusals into actionable messages', () => {
    expect(describeError({ code: '42501' })).toMatch(/only a dictator/i);
    expect(describeError({ code: '23505', message: 'roster_memberships_player_season_key' })).toMatch(/already on a team this season/);
    expect(describeError({ code: '23505', message: 'roster_memberships_entry_jersey_key' })).toMatch(/jersey number is already taken/);
    expect(describeError({ code: '23503', message: 'This player has goals or assists this season, so their place on the roster is kept' })).toMatch(/place on the roster is kept/);
    expect(describeError({ code: '23503', message: 'fk' })).toMatch(/kept/);
  });
});

describe('choosing a division, season and team', () => {
  it('shows loading, then each level only after the previous choice, with empty states', async () => {
    render(<ManageRosters />);
    expect(screen.getByRole('option', { name: /loading divisions/i })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('option', { name: 'WSL' })).toBeTruthy());
    expect(screen.getByLabelText('Season').disabled).toBe(true);
    pick('Division', 'd2');
    await waitFor(() => expect(screen.getByRole('option', { name: /this division has no seasons/i })).toBeTruthy());
    pick('Division', 'd1');
    await waitFor(() => expect(screen.getByRole('option', { name: '2026 (current)' })).toBeTruthy());
    pick('Season', 's1');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Alpha' })).toBeTruthy());
    // Only the chosen season's teams; Gamma plays only 2025 and is offered as an existing team to add.
    const teamSelect = screen.getByLabelText('Team');
    expect(within(teamSelect).queryByRole('option', { name: 'Gamma' })).toBeNull();
    expect(within(screen.getByLabelText('Existing team')).getByRole('option', { name: 'Gamma' })).toBeTruthy();
    pick('Team', 'e2');
    await waitFor(() => expect(screen.getByText(/no players on this roster yet/i)).toBeTruthy());
  });

  it('lists the team\'s players in a dropdown and opens the chosen one with its card, roster place and private email', async () => {
    await openTeam();
    await waitFor(() => expect(screen.getByRole('option', { name: /9 · Ada Striker · ST/ })).toBeTruthy());
    expect(screen.queryByLabelText('Edit first name')).toBeNull();
    pick('Player', 'm1');
    expect(screen.getByLabelText('Edit first name').value).toBe('Ada');
    expect(screen.getByLabelText('Edit jersey').value).toBe('9');
    expect(screen.getByLabelText('Edit rating').value).toBe('70');
    expect(screen.getByLabelText('Edit attributes').value).toBe('{"pace":80}');
    expect(screen.getByLabelText('Edit email').value).toBe('ada@iiitkottayam.ac.in');
  });
});

describe('teams in the season', () => {
  it('adds an existing team of the division to the season', async () => {
    await openTeam();
    pick('Existing team', 't3');
    fireEvent.click(screen.getByRole('button', { name: /add team/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Gamma added to 2026/));
    expect(writes()).toEqual([{ table: 'team_entries', op: 'insert', payload: { team_id: 't3', season_id: 's1' }, filters: [], opts: {} }]);
  });

  it('creates a new team in the season, and refuses a too-short name without writing', async () => {
    await openTeam();
    pick('New team name', 'X');
    fireEvent.click(screen.getByRole('button', { name: /create team/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/2 to 60/);
    expect(writes()).toEqual([]);
    pick('New team name', 'Delta Rovers');
    fireEvent.click(screen.getByRole('button', { name: /create team/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Delta Rovers created and added to 2026/));
    expect(writes().map((w) => [w.table, w.op, w.payload])).toEqual([
      ['teams', 'insert', { name: 'Delta Rovers', short_name: 'DELT' }],
      ['team_entries', 'insert', { team_id: expect.any(String), season_id: 's1' }],
    ]);
  });
});

describe('players', () => {
  it('creates a player on the roster through create_rostered_player, after validating', async () => {
    await openTeam();
    const form = screen.getByRole('form', { name: 'New player' });
    pick('New first name', 'Bea');
    pick('New rating', '150');
    fireEvent.click(within(form).getByRole('button', { name: /create player/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/1 and 99/);
    expect(rpc).not.toHaveBeenCalled();
    pick('New rating', '64');
    pick('New last name', 'Keeper');
    pick('New jersey', '1');
    pick('New position', 'GK');
    pick('New email', 'Bea@IIITKottayam.ac.in');
    fireEvent.click(within(form).getByRole('button', { name: /create player/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Bea Keeper added to Alpha/));
    expect(rpc).toHaveBeenCalledWith('create_rostered_player', {
      p_team_entry_id: 'e1', p_first_name: 'Bea', p_last_name: 'Keeper', p_jersey_number: 1, p_position: 'GK',
      p_overall_rating: 64, p_attributes: {}, p_image_url: null, p_email: 'bea@iiitkottayam.ac.in',
    });
    await waitFor(() => expect(screen.getByRole('option', { name: /1 · Bea Keeper · GK/ })).toBeTruthy());
  });

  it('reports a refusal from the database and keeps the form', async () => {
    db.fail['rpc.create_rostered_player'] = { code: '42501', message: 'Only a dictator can create players' };
    await openTeam();
    pick('New first name', 'Bea');
    fireEvent.click(within(screen.getByRole('form', { name: 'New player' })).getByRole('button', { name: /create player/i }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/only a dictator/i));
    expect(screen.getByLabelText('New first name').value).toBe('Bea');
  });

  it('saves the card, the roster place and the private email; an empty email clears it', async () => {
    await openTeam();
    await waitFor(() => screen.getByRole('option', { name: /Ada Striker/ }));
    pick('Player', 'm1');
    pick('Edit last name', 'Finisher');
    pick('Edit jersey', '10');
    pick('Edit email', '');
    fireEvent.click(screen.getByRole('button', { name: /save player/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Ada saved/));
    expect(writes().map((w) => [w.table, w.op, w.payload, w.filters])).toEqual([
      ['players', 'update', { first_name: 'Ada', last_name: 'Finisher', overall_rating: 70, attributes: { pace: 80 } }, [['id', 'p1']]],
      ['roster_memberships', 'update', { jersey_number: 10, position: 'ST' }, [['id', 'm1']]],
      ['player_private_details', 'delete', null, [['player_id', 'p1']]],
    ]);
  });

  it('moves a player to another team of the season', async () => {
    await openTeam();
    await waitFor(() => screen.getByRole('option', { name: /Ada Striker/ }));
    pick('Player', 'm1');
    pick('Move to team', 'e2');
    fireEvent.click(screen.getByRole('button', { name: /^move$/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Moved to Beta/));
    expect(writes()).toEqual([expect.objectContaining({ table: 'roster_memberships', op: 'update', payload: { team_entry_id: 'e2' } })]);
  });

  it('explains why a roster place with goals is kept', async () => {
    db.fail['roster_memberships.delete'] = { code: '23503', message: 'This player has goals or assists this season, so their place on the roster is kept' };
    await openTeam();
    await waitFor(() => screen.getByRole('option', { name: /Ada Striker/ }));
    pick('Player', 'm1');
    fireEvent.click(screen.getByRole('button', { name: /remove from roster/i }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/goals or assists this season/));
    expect(db.tables.roster_memberships).toHaveLength(1);
  });

  it('finds an existing player from another season and adds them to this roster', async () => {
    await openTeam();
    await waitFor(() => screen.getByRole('option', { name: /Ada Striker/ }));
    pick('Search players', 'ada');
    fireEvent.click(screen.getByRole('button', { name: /find/i }));
    const list = await screen.findByRole('list', { name: 'Matching players' });
    expect(within(list).queryByText(/Ada Striker/)).toBeNull(); // already on this roster
    fireEvent.click(within(list).getByRole('button', { name: /add to alpha/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Adam Other added to Alpha/));
    expect(writes()).toEqual([expect.objectContaining({ table: 'roster_memberships', op: 'insert', payload: { player_id: 'p2', team_entry_id: 'e1', season_id: 's1' } })]);
  });
});
