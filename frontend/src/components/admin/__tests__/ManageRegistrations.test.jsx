// @vitest-environment jsdom
// Group: frontend-components. Captains & registrations: division -> season -> team dropdowns, each depending on the
// one before; only the chosen team's registration in the chosen season is shown; a late answer for an earlier team is
// ignored; changing a captain updates the existing registration (its id is sent, nothing new is inserted), assigning
// creates one, revoking deletes it, and after each the captain is reloaded from the database. Accounts are found by
// every word and labelled by the account directory, never by profile email or id.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = {};
function seed() {
  Object.assign(db, {
    divisions: [{ id: 'd1', slug: 'freshers', name: 'Freshers', sort_order: 1 }, { id: 'd2', slug: 'wsl', name: 'WSL', sort_order: 2 }],
    seasons: [{ id: 's1', division_id: 'd1', slug: '2026', name: '2026', is_current: true, sort_order: 1 }, { id: 's0', division_id: 'd1', slug: '2025', name: '2025', is_current: false, sort_order: 0 }],
    team_entries: [{ team_id: 't1', season_id: 's1' }, { team_id: 't2', season_id: 's1' }, { team_id: 't3', season_id: 's0' }],
    teams: [{ id: 't1', name: 'Alpha' }, { id: 't2', name: 'Beta' }, { id: 't3', name: 'Gamma' }],
    team_registrations: [
      { id: 'r1', team_id: 't1', team_name: 'Alpha', season_id: 's1', captain_id: 'u-cap' },
      { id: 'r3', team_id: 't3', team_name: 'Gamma', season_id: 's0', captain_id: 'u-old' },
    ],
    accounts: [
      { user_id: 'u-cap', label: 'Cara Cap (cara@iiitkottayam.ac.in)' },
      { user_id: 'u-old', label: 'Olly Old (olly@iiitkottayam.ac.in)' },
      { user_id: 'u-ada1', label: 'Ada Lane (ada@iiitkottayam.ac.in)' },
      { user_id: 'u-ada2', label: 'Ada Lane (ada.l@iiitkottayam.ac.in)' },
    ],
    slowTeam: null,
    posts: [],
    postFail: null,
  });
}

function from(table) {
  const q = { filters: [], ins: [], op: 'select', single: false };
  const rows = () => db[table].filter((r) => q.filters.every(([c, v]) => r[c] === v) && q.ins.every(([c, vs]) => vs.includes(r[c])));
  const b = {
    select: () => b, order: () => b,
    eq: (c, v) => { q.filters.push([c, v]); return b; },
    in: (c, vs) => { q.ins.push([c, vs]); return b; },
    maybeSingle: () => { q.single = true; return b; },
    delete: () => { q.op = 'delete'; return b; },
    then: (resolve, reject) => {
      const slow = table === 'team_registrations' && q.single && db.slowTeam && q.filters.some(([c, v]) => c === 'team_id' && v === db.slowTeam);
      return (slow ? new Promise((r) => setTimeout(r, 60)) : Promise.resolve()).then(() => {
        if (q.op === 'delete') {
          const gone = rows();
          db[table] = db[table].filter((r) => !gone.includes(r));
          return { data: gone.map((r) => ({ id: r.id })), error: null };
        }
        const found = rows().map((r) => ({ ...r }));
        return { data: q.single ? found[0] ?? null : found, error: null };
      }).then(resolve, reject);
    },
  };
  return b;
}
const directory = async (args) => {
  if (args.p_ids) return { data: db.accounts.filter((a) => args.p_ids.includes(a.user_id)), error: null };
  const words = args.p_query.toLowerCase().split(/\s+/).filter(Boolean);
  return { data: db.accounts.filter((a) => words.every((w) => a.label.toLowerCase().includes(w))), error: null };
};
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (t) => from(t),
    rpc: (_name, args) => directory(args),
    auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
  },
}));
const { default: ManageRegistrations } = await import('../ManageRegistrations');

// The registration route: updates by id, inserts otherwise (as the backend does).

beforeEach(() => {
  seed();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(init.body);
    db.posts.push(body);
    if (db.postFail) return new Response(JSON.stringify({ message: db.postFail }), { status: 409 });
    if (body.id) Object.assign(db.team_registrations.find((r) => r.id === body.id), { captain_id: body.captain_id });
    else db.team_registrations.push({ id: `r-new-${db.posts.length}`, team_id: body.team_id, team_name: body.team_name, season_id: body.season, captain_id: body.captain_id });
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const pick = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const captainText = () => screen.getByRole('region', { name: 'Captain' }).textContent;
async function openTeam(team) {
  render(<ManageRegistrations />);
  await waitFor(() => expect(screen.getByRole('option', { name: 'Freshers' })).toBeTruthy());
  pick('Division', 'd1');
  await waitFor(() => expect(screen.getByRole('option', { name: '2026 (current)' })).toBeTruthy());
  pick('Season', 's1');
  await waitFor(() => expect(screen.getByRole('option', { name: 'Alpha' })).toBeTruthy());
  if (team) pick('Team', team);
}
async function chooseAccount(teamName, query, value) {
  fireEvent.change(screen.getByLabelText(`Find captain for ${teamName}`), { target: { value: query } });
  await waitFor(() => expect(within(screen.getByLabelText(`New captain for ${teamName}`)).getAllByRole('option').length).toBeGreaterThan(1));
  pick(`New captain for ${teamName}`, value);
}

describe('ManageRegistrations', () => {
  it('offers each level only after the previous choice, and only that season’s teams', async () => {
    render(<ManageRegistrations />);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Freshers' })).toBeTruthy());
    expect(screen.getByLabelText('Season').disabled).toBe(true);
    expect(screen.getByLabelText('Team').disabled).toBe(true);
    pick('Division', 'd2');
    expect(await screen.findByRole('option', { name: 'This division has no seasons' })).toBeTruthy();
    pick('Division', 'd1');
    await waitFor(() => expect(screen.getByRole('option', { name: '2026 (current)' })).toBeTruthy());
    pick('Season', 's1');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Alpha' })).toBeTruthy());
    expect(within(screen.getByLabelText('Team')).queryByRole('option', { name: 'Gamma' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Captain' })).toBeNull();
  });

  it('shows only the chosen team’s captain for the chosen season, by directory label', async () => {
    await openTeam('t1');
    await waitFor(() => expect(captainText()).toMatch(/Captain of Alpha in this season: Cara Cap \(cara@iiitkottayam\.ac\.in\)/));
    pick('Team', 't2');
    await waitFor(() => expect(captainText()).toMatch(/Beta has no captain in this season/));
    expect(document.body.textContent).not.toMatch(/Cara Cap|u-cap|Olly/);
  });

  it('ignores a late answer for the previously chosen team', async () => {
    await openTeam();
    db.slowTeam = 't1';
    pick('Team', 't1');
    pick('Team', 't2');
    await waitFor(() => expect(captainText()).toMatch(/Beta has no captain/));
    await new Promise((r) => setTimeout(r, 120));
    expect(captainText()).toMatch(/Beta has no captain/);
    expect(captainText()).not.toMatch(/Cara/);
  });

  it('changes a captain by updating the existing registration, then shows the captain the database holds', async () => {
    await openTeam('t1');
    await waitFor(() => expect(captainText()).toMatch(/Cara Cap/));
    await chooseAccount('Alpha', 'ada lane', 'u-ada2');
    const choices = within(screen.getByLabelText('New captain for Alpha')).getAllByRole('option').map((o) => o.textContent);
    expect(choices).toEqual(['Choose from the search results', 'Ada Lane (ada@iiitkottayam.ac.in)', 'Ada Lane (ada.l@iiitkottayam.ac.in)']);
    fireEvent.click(screen.getByRole('button', { name: /change captain/i }));
    await waitFor(() => expect(captainText()).toMatch(/Captain of Alpha in this season: Ada Lane \(ada\.l@iiitkottayam\.ac\.in\)/));
    expect(db.posts).toEqual([expect.objectContaining({ id: 'r1', team_id: 't1', season: 's1', division: 'freshers', captain_id: 'u-ada2' })]);
    expect(db.team_registrations.filter((r) => r.team_id === 't1')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toMatch(/Ada Lane \(ada\.l@iiitkottayam\.ac\.in\) is now the captain of Alpha/);
  });

  it('assigns a captain to a team without one, leaving out accounts that captain another team', async () => {
    await openTeam('t2');
    await waitFor(() => expect(captainText()).toMatch(/Beta has no captain/));
    fireEvent.change(screen.getByLabelText('Find captain for Beta'), { target: { value: 'iiitkottayam' } });
    await waitFor(() => expect(within(screen.getByLabelText('New captain for Beta')).getAllByRole('option').length).toBe(3));
    expect(screen.getByLabelText('New captain for Beta').textContent).not.toMatch(/Cara|Olly/);
    pick('New captain for Beta', 'u-ada1');
    fireEvent.click(screen.getByRole('button', { name: /assign captain/i }));
    await waitFor(() => expect(captainText()).toMatch(/Captain of Beta in this season: Ada Lane \(ada@iiitkottayam\.ac\.in\)/));
    expect(db.posts[0]).not.toHaveProperty('id');
  });

  it('revokes a captain and shows the team without one; a refused change keeps the database’s captain', async () => {
    await openTeam('t1');
    await waitFor(() => expect(captainText()).toMatch(/Cara Cap/));
    await chooseAccount('Alpha', 'ada', 'u-ada1');
    db.postFail = 'This account already captains another team.';
    fireEvent.click(screen.getByRole('button', { name: /change captain/i }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/already captains another team/);
    await waitFor(() => expect(captainText()).toMatch(/Cara Cap/));
    fireEvent.click(screen.getByRole('button', { name: /revoke captain/i }));
    await waitFor(() => expect(captainText()).toMatch(/Alpha has no captain in this season/));
    expect(db.team_registrations.find((r) => r.id === 'r1')).toBeUndefined();
  });
});
