// @vitest-environment jsdom
// Group: frontend-components. The dictator's Teams & Rosters flow against an in-memory Data API fake: loading,
// empty, success and error states; validation before any write; and the exact writes it sends (one reusable player
// card, one roster place per season). Every new player starts from a verified account (an account that already has a
// player is offered as that player), only linked players join a roster, and a player's email is their account's. The real UI -> Data API -> database path is ManageRosters.local.test.jsx.
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
  };
  // Linked players and their account's Auth email (player_link_status); p2 is a legacy player without an account.
  db.linked = { p1: 'ada@iiitkottayam.ac.in', p3: 'adam.three@iiitkottayam.ac.in' };
  // Verified accounts (verified_accounts_for_linking).
  db.accounts = [
    { user_id: 'u-bea', email: 'bea@iiitkottayam.ac.in', linked_player_id: null, linked_player_name: null, linked_player_place: null, key_player_id: null },
    { user_id: 'u-ada', email: 'ada@iiitkottayam.ac.in', linked_player_id: 'p1', linked_player_name: 'Ada Striker', linked_player_place: 'Alpha · 2026 (WSL)', key_player_id: null },
    { user_id: 'u-wait', email: 'adam.two@iiitkottayam.ac.in', linked_player_id: null, key_player_id: 'p2', key_player_name: 'Adam Other', key_player_place: null },
  ];
  db.tables.seasons.push({ id: 's0', division_id: 'd1', slug: '2025', name: '2025', is_current: false, sort_order: 0 });
  db.calls = [];
  db.fail = {};
  db.slow = null;
  // What search_players returns: identities with their latest roster place and the season flag.
  db.searchPlayers = [
    { player_id: 'p1', first_name: 'Ada', last_name: 'Striker', overall_rating: 70, in_season: true, last_team: 'Alpha', last_season: '2026', last_division: 'WSL', last_jersey: 9 },
    { player_id: 'p2', first_name: 'Adam', last_name: 'Other', overall_rating: 60, in_season: false, last_team: null, last_season: null, last_division: null, last_jersey: null },
    { player_id: 'p3', first_name: 'Adam', last_name: 'Other', overall_rating: 65, in_season: false, last_team: 'Gamma', last_season: '2025', last_division: 'WSL', last_jersey: 4 },
  ];
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
    maybeSingle: () => { q.single = true; return b; },
    then: (resolve, reject) => (db.slow && q.filters.some(([c, v]) => c === 'team_entry_id' && v === db.slow)
      ? new Promise((r) => setTimeout(r, 50)) : Promise.resolve()).then(() => {
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
  if (name === 'create_team_in_season') {
    const team = `t-${nextId++}`;
    db.tables.teams.push({ id: team, name: args.p_name });
    db.tables.team_entries.push({ id: `e-${nextId++}`, team_id: team, season_id: args.p_season_id });
    return { data: team, error: null };
  }
  if (name === 'player_link_status') return { data: args.p_player_ids.map((id) => ({ player_id: id, linked: Boolean(db.linked[id]), email: db.linked[id] ?? null, has_key: false })), error: null };
  if (name === 'verified_accounts_for_linking') return { data: db.accounts.filter((a) => a.email.includes(args.p_query.toLowerCase())), error: null };
  if (name === 'account_link_matches') return { data: [], error: null };
  if (name === 'link_player_account') { db.linked[args.p_player] = db.accounts.find((a) => a.user_id === args.p_user)?.email; return { data: null, error: null }; }
  if (name === 'add_player_to_roster') {
    if (!db.linked[args.p_player]) return { data: null, error: { code: '23514', message: 'This player is not linked to an account yet. Link them to a verified account before adding them to a roster.' } };
    const entry = db.tables.team_entries.find((e) => e.id === args.p_team_entry_id);
    const id = `m-${nextId++}`;
    db.tables.roster_memberships.push({ id, player_id: args.p_player, team_entry_id: entry.id, season_id: entry.season_id, jersey_number: args.p_jersey_number ?? null, position: args.p_position ?? null });
    return { data: id, error: null };
  }
  if (name === 'search_players') {
    if (db.fail['rpc.search_players']) return { data: null, error: db.fail['rpc.search_players'] };
    const words = args.p_query.toLowerCase().split(/\s+/).filter(Boolean);
    return { data: db.searchPlayers.filter((p) => words.every((w) => `${p.first_name} ${p.last_name}`.toLowerCase().includes(w))), error: null };
  }
  if (name === 'update_rostered_player') {
    const place = db.tables.roster_memberships.find((m) => m.id === args.p_membership_id);
    Object.assign(db.tables.players.find((p) => p.id === place.player_id), { first_name: args.p_first_name, last_name: args.p_last_name, overall_rating: args.p_overall_rating, attributes: args.p_attributes });
    Object.assign(place, { jersey_number: args.p_jersey_number, position: args.p_position });
    return { data: null, error: null };
  }
  if (name === 'delete_unplayed_player') {
    db.tables.roster_memberships = db.tables.roster_memberships.filter((m) => m.player_id !== args.p_player_id);
    db.tables.players = db.tables.players.filter((p) => p.id !== args.p_player_id);
    return { data: null, error: null };
  }
  if (name === 'create_player_for_account') {
    const id = `p-${nextId++}`;
    db.tables.players.push({ id, first_name: args.p_first_name, last_name: args.p_last_name, overall_rating: args.p_overall_rating, attributes: args.p_attributes });
    db.linked[id] = db.accounts.find((a) => a.user_id === args.p_user)?.email;
    const entry = db.tables.team_entries.find((e) => e.id === args.p_team_entry_id);
    db.tables.roster_memberships.push({ id: `m-${nextId++}`, player_id: id, team_entry_id: entry.id, season_id: entry.season_id, jersey_number: args.p_jersey_number, position: args.p_position });
    return { data: id, error: null };
  }
  return { data: null, error: { message: `unexpected call ${name}` } };
});

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: (t) => from(t), rpc: (...a) => rpc(...a), auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } },
}));

import ManageRosters, { describeError, validatePlayer, blankPlayer } from '../ManageRosters';

beforeEach(() => { seed(); rpc.mockClear(); vi.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const READS = new Set(['search_players', 'player_link_status', 'verified_accounts_for_linking', 'account_link_matches']);
const writes = () => db.calls.filter((c) => (c.rpc && !READS.has(c.rpc)) || ['insert', 'update', 'delete', 'upsert'].includes(c.op));
const pick = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

// The new player's account comes first: search verified accounts by email and choose one.
async function chooseNewAccount(text, action = 'Choose') {
  pick('New player email search', text);
  const list = await screen.findByRole('list', { name: 'New player matches' });
  fireEvent.click(within(list).getByRole('button', { name: new RegExp(`^${action} `) }));
}

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
    const badStat = blankPlayer(); badStat.first_name = 'A'; badStat.card.stats.Pace = '120';
    expect(validatePlayer(badStat).error).toMatch(/Pace must be a whole number between 1 and 99/);
    const ok = { ...blankPlayer(), first_name: ' Ada ', last_name: 'S', jersey_number: '0', overall_rating: '80', baseAttributes: { pace: 9, extra: 1 } };
    ok.card = { ...ok.card, stats: { ...ok.card.stats, Pace: '9' } };
    expect(validatePlayer(ok).value)
      .toEqual({ first_name: 'Ada', last_name: 'S', jersey_number: 0, position: null, overall_rating: 80, attributes: { extra: 1, stats: { Pace: { total: 9 } } } });
  });

  it('leaves the rating unset unless one is entered, and still refuses an out-of-range one', () => {
    expect(validatePlayer({ ...blankPlayer(), first_name: 'A' }).value.overall_rating).toBeNull();
    expect(validatePlayer({ ...blankPlayer(), first_name: 'A', overall_rating: ' ' }).value.overall_rating).toBeNull();
    expect(validatePlayer({ ...blankPlayer(), first_name: 'A', overall_rating: '100' }).error).toMatch(/1 and 99, or left empty/);
  });

  it('turns database refusals into actionable messages', () => {
    expect(describeError({ code: '42501' })).toMatch(/only a dictator/i);
    expect(describeError({ code: '23505', message: 'roster_memberships_player_season_key' })).toMatch(/already on a team this season/);
    expect(describeError({ code: '23505', message: 'roster_memberships_entry_jersey_key' })).toMatch(/jersey number is already taken/);
    expect(describeError({ code: '23503', message: 'This player has goals or assists this season, so their place on the roster is kept' })).toMatch(/place on the roster is kept/);
    expect(describeError({ code: '23503', message: 'fk' })).toMatch(/kept/);
    expect(describeError({ code: '23514', message: 'This player is not linked to an account yet.' })).toMatch(/Link them to a verified account/);
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

  it('marks a player linked to an account and shows the account\'s email in the player panel', async () => {
    await openTeam();
    await waitFor(() => expect(screen.getByRole('option', { name: /9 · Ada Striker · ST · linked account/ })).toBeTruthy());
    expect(rpc).toHaveBeenCalledWith('player_link_status', { p_player_ids: expect.arrayContaining(['p1']) });
    pick('Player', 'm1');
    expect(within(screen.getByRole('group', { name: 'Player account' })).getByText(/Linked to/).textContent).toMatch(/ada@iiitkottayam/);
    expect(screen.getByText('Account matching')).toBeTruthy();
    expect(screen.getByText('Link an account to a player')).toBeTruthy();
  });

  it('lists the team\'s players in a dropdown and opens the chosen one with its card and roster place; the email is read-only', async () => {
    await openTeam();
    await waitFor(() => expect(screen.getByRole('option', { name: /9 · Ada Striker · ST/ })).toBeTruthy());
    expect(screen.queryByLabelText('Edit first name')).toBeNull();
    pick('Player', 'm1');
    expect(screen.getByLabelText('Edit first name').value).toBe('Ada');
    expect(screen.getByLabelText('Edit jersey').value).toBe('9');
    expect(screen.getByLabelText('Edit rating').value).toBe('70');
    expect(screen.getByLabelText('Edit Pace').value).toBe('80'); // an older flat value is shown in the structured field
    expect(screen.getByLabelText('Edit Shooting').value).toBe('');
    expect(screen.getByLabelText('Edit preferred foot').value).toBe('');
    expect(screen.getByLabelText('Edit play style').value).toBe(''); // no play style: not set
    expect(screen.queryByLabelText('Edit email')).toBeNull(); // no email field: the email is the account's
    expect(within(screen.getByRole('group', { name: 'Player account' })).getByText(/read-only/)).toBeTruthy();
  });
  it('shows the roster of the team chosen last, even when an earlier team answers later', async () => {
    db.slow = 'e1';
    await openTeam('e1');
    pick('Team', 'e2');
    await new Promise((r) => setTimeout(r, 120));
    expect(screen.getByText(/no players on this roster yet/i)).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Ada Striker/ })).toBeNull();
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
    // One database call creates the team and its season entry together.
    expect(writes()).toEqual([{ rpc: 'create_team_in_season', args: { p_season_id: 's1', p_name: 'Delta Rovers' } }]);
    await waitFor(() => expect(within(screen.getByLabelText('Team')).getByRole('option', { name: 'Delta Rovers' })).toBeTruthy());
  });
});

describe('players', () => {
  it('creates a player for a chosen verified account through create_player_for_account, after validating', async () => {
    await openTeam();
    const form = screen.getByRole('form', { name: 'New player' });
    expect(screen.queryByLabelText('New first name')).toBeNull(); // the account comes first
    await chooseNewAccount('bea');
    pick('New first name', 'Bea');
    pick('New rating', '150');
    fireEvent.click(within(form).getByRole('button', { name: /create player/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/1 and 99/);
    expect(writes()).toEqual([]);
    pick('New rating', '64');
    pick('New last name', 'Keeper');
    pick('New jersey', '1');
    pick('New position', 'GK');
    fireEvent.click(within(form).getByRole('button', { name: /create player/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Bea Keeper added to Alpha, linked to bea@iiitkottayam.ac.in/));
    expect(rpc).toHaveBeenCalledWith('create_player_for_account', {
      p_user: 'u-bea', p_team_entry_id: 'e1', p_first_name: 'Bea', p_last_name: 'Keeper', p_jersey_number: 1, p_position: 'GK',
      p_overall_rating: 64, p_attributes: {}, p_image_url: null,
    });
    await waitFor(() => expect(screen.getByRole('option', { name: /1 · Bea Keeper · GK/ })).toBeTruthy());
  });

  it('creates a player without a rating when none is entered (never 50)', async () => {
    await openTeam();
    await chooseNewAccount('bea');
    pick('New first name', 'Una');
    fireEvent.click(within(screen.getByRole('form', { name: 'New player' })).getByRole('button', { name: /create player/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Una added to Alpha/));
    expect(rpc.mock.calls.find(([name]) => name === 'create_player_for_account')[1].p_overall_rating).toBeNull();
  });

  it('offers the existing player of an account that already has one, instead of a duplicate', async () => {
    await openTeam('e2');
    await chooseNewAccount('ada@', 'Use their player');
    const offer = screen.getByRole('group', { name: 'Existing player for this account' });
    expect(offer.textContent).toMatch(/already has a player: Ada Striker/);
    expect(screen.queryByLabelText('New first name')).toBeNull();
    fireEvent.click(within(offer).getByRole('button', { name: 'Add Ada Striker to Beta' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Ada Striker added to Beta/));
    expect(writes()).toEqual([{ rpc: 'add_player_to_roster', args: { p_player: 'p1', p_team_entry_id: 'e2' } }]);
  });

  it('links and adds a legacy player waiting for the account (same email)', async () => {
    await openTeam();
    await chooseNewAccount('adam.two', 'Use their player');
    const offer = screen.getByRole('group', { name: 'Existing player for this account' });
    expect(offer.textContent).toMatch(/Adam Other is waiting for this account/);
    fireEvent.click(within(offer).getByRole('button', { name: 'Link Adam Other and add to Alpha' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Adam Other is linked to adam.two@iiitkottayam.ac.in and added to Alpha/));
    expect(writes()).toEqual([
      { rpc: 'link_player_account', args: { p_player: 'p2', p_user: 'u-wait' } },
      { rpc: 'add_player_to_roster', args: { p_player: 'p2', p_team_entry_id: 'e1' } },
    ]);
  });

  it('reports a refusal from the database and keeps the form', async () => {
    db.fail['rpc.create_player_for_account'] = { code: '42501', message: 'Only a dictator can create players' };
    await openTeam();
    await chooseNewAccount('bea');
    pick('New first name', 'Bea');
    fireEvent.click(within(screen.getByRole('form', { name: 'New player' })).getByRole('button', { name: /create player/i }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/only a dictator/i));
    expect(screen.getByLabelText('New first name').value).toBe('Bea');
  });

  it('saves the card and the roster place in one call, with no email', async () => {
    await openTeam();
    await waitFor(() => screen.getByRole('option', { name: /Ada Striker/ }));
    pick('Player', 'm1');
    pick('Edit last name', 'Finisher');
    pick('Edit jersey', '10');
    fireEvent.click(screen.getByRole('button', { name: /save player/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Ada saved/));
    expect(writes()).toEqual([{ rpc: 'update_rostered_player', args: {
      p_membership_id: 'm1', p_first_name: 'Ada', p_last_name: 'Finisher', p_overall_rating: 70, p_attributes: { stats: { Pace: { total: 80 } } },
      p_jersey_number: 10, p_position: 'ST',
    } }]);
  });

  it('saves in one database call, so a refused jersey number saves nothing and says why', async () => {
    db.fail['rpc.update_rostered_player'] = { code: '23505', message: 'duplicate key value violates unique constraint "roster_memberships_entry_jersey_key"' };
    await openTeam();
    await waitFor(() => screen.getByRole('option', { name: /Ada Striker/ }));
    pick('Player', 'm1');
    pick('Edit last name', 'Finisher');
    fireEvent.click(screen.getByRole('button', { name: /save player/i }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/jersey number is already taken/i));
    expect(writes()).toHaveLength(1);
    expect(db.tables.players.find((p) => p.id === 'p1').last_name).toBe('Striker');
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

  it('deletes a player who never played in one database call, and explains a refusal without changing the form', async () => {
    db.fail['rpc.delete_unplayed_player'] = { code: '23503', message: 'This player has match history, so the player is kept' };
    await openTeam();
    await waitFor(() => screen.getByRole('option', { name: /Ada Striker/ }));
    pick('Player', 'm1');
    fireEvent.click(screen.getByRole('button', { name: /delete player/i }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/match history, so the player is kept/));
    expect(db.tables.roster_memberships).toHaveLength(1);
    expect(screen.getByLabelText('Edit first name').value).toBe('Ada');
    delete db.fail['rpc.delete_unplayed_player'];
    fireEvent.click(screen.getByRole('button', { name: /delete player/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Ada Striker deleted/));
    expect(writes().filter((w) => w.rpc)).toEqual([
      { rpc: 'delete_unplayed_player', args: { p_player_id: 'p1' } },
      { rpc: 'delete_unplayed_player', args: { p_player_id: 'p1' } },
    ]);
    expect(writes().filter((w) => w.table)).toEqual([]); // never a separate roster delete
  });

  it('searches as you type by full name, telling same-name players apart by their latest roster place', async () => {
    await openTeam();
    await waitFor(() => screen.getByRole('option', { name: /Ada Striker/ }));
    pick('Search players', 'a');
    expect(await screen.findByText('Type at least two letters of the name.')).toBeTruthy();
    pick('Search players', 'adam other');
    const list = await screen.findByRole('list', { name: 'Matching players' });
    expect(screen.getByText('2 players found')).toBeTruthy();
    const items = within(list).getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toMatch(/Adam Other.*OVR 60.*Latest: Not on a roster yet.*Not linked to an account: link first/);
    expect(items[1]).toMatch(/Adam Other.*OVR 65.*Latest: Gamma · 2025 \(WSL\) · #4/);
    expect(db.calls.find((c) => c.rpc === 'search_players').args).toMatchObject({ p_query: 'adam other', p_season_id: 's1' });
    // Only the linked one can be added.
    expect(within(list).getAllByRole('button', { name: 'Add Adam Other to Alpha' })).toHaveLength(1);
    fireEvent.click(within(list).getByRole('button', { name: 'Add Adam Other to Alpha' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Adam Other added to Alpha/));
    expect(writes()).toEqual([{ rpc: 'add_player_to_roster', args: { p_player: 'p3', p_team_entry_id: 'e1' } }]);
  });

  it('marks a player already in this season instead of offering to add them, and explains no matches', async () => {
    await openTeam();
    await waitFor(() => screen.getByRole('option', { name: /Ada Striker/ }));
    pick('Search players', 'ada striker');
    const list = await screen.findByRole('list', { name: 'Matching players' });
    expect(within(list).getByText('Already in this season')).toBeTruthy();
    expect(within(list).queryByRole('button')).toBeNull();
    pick('Search players', 'zz nobody');
    expect(await screen.findByText(/No player matches “zz nobody”. Create them below./)).toBeTruthy();
  });

  it('reports a failed search and can retry', async () => {
    db.fail['rpc.search_players'] = { message: 'timeout' };
    await openTeam();
    await waitFor(() => screen.getByRole('option', { name: /Ada Striker/ }));
    pick('Search players', 'adam');
    expect(await screen.findByText(/player search failed \(timeout\)/i)).toBeTruthy();
    delete db.fail['rpc.search_players'];
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('2 players found')).toBeTruthy();
  });

  it('shows the chosen player\'s FUT card from the identity, with this season\'s place beside it', async () => {
    await openTeam();
    await waitFor(() => screen.getByRole('option', { name: /Ada Striker/ }));
    pick('Player', 'm1');
    const card = within(screen.getByLabelText('Edit player')).getByRole('figure', { name: 'FUT card: Ada Striker' });
    expect(within(card).getByTestId('card-rating').textContent).toBe('70');
    expect(card.textContent).toMatch(/PAC80/); // the older flat value, shown in its canonical place
    expect(card.textContent).not.toMatch(/#9|\bST\b/);
    expect(within(screen.getByLabelText('Edit player')).getByLabelText("This season's place").textContent).toMatch(/#9 · ST · Alpha/);
  });
});

describe('the FUT card in the player forms', () => {
  let fetchSpy;
  beforeEach(() => {
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:local-${++n}`);
    URL.revokeObjectURL = vi.fn();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  const respond = (status, body) => fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
  const newCard = () => within(screen.getByRole('form', { name: 'New player' })).getByRole('figure');
  const editCard = () => within(screen.getByLabelText('Edit player')).getByRole('figure');
  const png = () => new File(['png'], 'face.png', { type: 'image/png' });

  it('previews a new player while it is typed: name, rating, stats, foot and play style, with no invented values', async () => {
    await openTeam();
    await chooseNewAccount('bea');
    expect(newCard().getAttribute('aria-label')).toBe('FUT card: Unnamed player');
    expect(within(newCard()).getByTestId('card-rating').textContent).toBe('—'); // no rating until one is entered
    expect(screen.getByLabelText('New rating').value).toBe('');
    expect(newCard().textContent).toMatch(/PAC—.*PHY—/);
    expect(newCard().textContent).toMatch(/Preferred foot: not set/);
    expect(newCard().textContent).toMatch(/Play style: not set/);
    pick('New first name', 'Bea');
    pick('New last name', 'Keeper');
    pick('New rating', '64');
    pick('New Pace', '71');
    pick('New preferred foot', 'Left');
    pick('New play style', 'Power Shot');
    expect(newCard().getAttribute('aria-label')).toBe('FUT card: Bea Keeper');
    expect(within(newCard()).getByTestId('card-rating').textContent).toBe('64');
    expect(newCard().textContent).toMatch(/PAC71/);
    expect(newCard().textContent).toMatch(/Preferred foot: Left/);
    expect(newCard().textContent).toMatch(/Play style: Power Shot/);
    expect(within(newCard()).getByRole('img', { name: 'Power Shot' })).toBeTruthy();
    pick('New play style', '');
    expect(newCard().textContent).toMatch(/Play style: not set/);
    pick('New play style', 'Tiki Taka');
    fireEvent.click(within(screen.getByRole('form', { name: 'New player' })).getByRole('button', { name: /create player/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Bea Keeper added to Alpha/));
    expect(rpc.mock.calls.find(([name]) => name === 'create_player_for_account')[1].p_attributes).toEqual({
      stats: { Pace: { total: 71 } }, bio: { preferredFoot: 'Left' },
      playStyle: 'Tiki Taka',
    });
  });

  it('shows a new player\'s picture before upload, then uploads it once the player exists', async () => {
    await openTeam();
    await chooseNewAccount('bea');
    pick('New first name', 'Bea');
    fireEvent.change(screen.getByLabelText('New portrait file'), { target: { files: [png()] } });
    expect(within(newCard()).getByRole('img', { name: 'Bea portrait' }).getAttribute('src')).toBe('blob:local-1');
    expect(newCard().textContent).toMatch(/not saved yet/);
    respond(200, { imageUrl: 'https://media/bea.png' });
    fireEvent.click(within(screen.getByRole('form', { name: 'New player' })).getByRole('button', { name: /create player/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Bea added to Alpha with their portrait/));
    const created = db.tables.players.find((p) => p.first_name === 'Bea');
    expect(created.image_url).toBe('https://media/bea.png');
    const sent = fetchSpy.mock.calls[0][1].body;
    expect(sent.get('membership_id')).toBe(db.tables.roster_memberships.find((m) => m.player_id === created.id).id);
  });

  it('keeps a new player when the picture fails, says so, and can retry the picture', async () => {
    await openTeam();
    await chooseNewAccount('bea');
    pick('New first name', 'Bea');
    fireEvent.change(screen.getByLabelText('New portrait file'), { target: { files: [png()] } });
    respond(502, { message: 'storage is down' });
    fireEvent.click(within(screen.getByRole('form', { name: 'New player' })).getByRole('button', { name: /create player/i }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Bea was added to Alpha, but the portrait did not save: storage is down/));
    expect(screen.queryByText(/with their portrait/)).toBeNull();
    expect(db.tables.players.find((p) => p.first_name === 'Bea').image_url).toBeUndefined();
    respond(200, { imageUrl: 'https://media/bea.png' });
    fireEvent.click(within(screen.getByRole('group', { name: 'New player portrait' })).getByRole('button', { name: /retry portrait upload/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Portrait saved for Bea/));
    expect(db.tables.players.find((p) => p.first_name === 'Bea').image_url).toBe('https://media/bea.png');
  });

  it('edits the card with structured fields, previewing the draft and keeping values the form does not show', async () => {
    db.tables.players[0].attributes = { pace: 80, stats: { Shooting: { total: 66, finishing: 70 } }, bio: { height: 170 }, playStyle: 'Power Shot', custom: 1 };
    await openTeam();
    await waitFor(() => screen.getByRole('option', { name: /Ada Striker/ }));
    pick('Player', 'm1');
    expect(screen.getByLabelText('Edit Shooting').value).toBe('66');
    expect(screen.getByLabelText('Edit play style').value).toBe('Power Shot');
    pick('Edit Shooting', '75');
    pick('Edit preferred foot', 'Right');
    pick('Edit play style', 'Finesse Shot');
    expect(editCard().textContent).toMatch(/SHO75/);
    expect(editCard().textContent).toMatch(/Preferred foot: Right/);
    expect(editCard().textContent).toMatch(/Play style: Finesse Shot/);
    expect(editCard().textContent).not.toMatch(/#9/);
    fireEvent.click(screen.getByRole('button', { name: /save player/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Ada saved/));
    expect(rpc.mock.calls.find(([name]) => name === 'update_rostered_player')[1].p_attributes).toEqual({
      custom: 1, // the older flat pace moved into its canonical place
      stats: { Pace: { total: 80 }, Shooting: { total: 75, finishing: 70 } },
      bio: { height: 170, preferredFoot: 'Right' },
      playStyle: 'Finesse Shot',
    });
  });

  it('previews a replacement portrait, reports a failed upload without claiming it saved, and retries', async () => {
    await openTeam();
    await waitFor(() => screen.getByRole('option', { name: /Ada Striker/ }));
    pick('Player', 'm1');
    respond(500, { message: 'too large' });
    fireEvent.change(screen.getByLabelText('Portrait file'), { target: { files: [png()] } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/The portrait did not save: too large/));
    expect(within(editCard()).getByRole('img', { name: 'Ada Striker portrait' }).getAttribute('src')).toBe('blob:local-1');
    expect(editCard().textContent).toMatch(/did not save/);
    expect(screen.queryByText('Portrait saved.')).toBeNull();
    respond(200, { imageUrl: 'https://media/ada.png' });
    fireEvent.click(screen.getByRole('button', { name: /retry portrait upload/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Portrait saved/));
    await waitFor(() => expect(within(editCard()).getByRole('img', { name: 'Ada Striker portrait' }).getAttribute('src')).toBe('https://media/ada.png'));
    expect(editCard().textContent).not.toMatch(/not saved|did not save/);
  });
});
