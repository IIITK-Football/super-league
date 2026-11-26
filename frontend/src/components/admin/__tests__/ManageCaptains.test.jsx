// @vitest-environment jsdom
// Group: frontend-components. Captains: division -> season -> team dropdowns, each depending on the one before; only
// the chosen team entry's captain in the chosen season is shown; a late answer for an earlier team is ignored; changing
// a captain calls assign_captain with the replace flag (one assignment stays), assigning calls it without, revoking
// calls revoke_captain, and after each the captain is reloaded from the database. A person may captain several entries
// so every account is offered. Accounts are found by every word and labelled by the account directory.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Confirmations are answered by globalThis.confirmAnswer (a vi.fn); the dialog itself is covered by the screens that use it.
vi.mock('../../ui', async (importOriginal) => ({ ...(await importOriginal()), useConfirm: () => globalThis.confirmAnswer, toast: (t) => globalThis.toasts.push(t) }));
globalThis.toasts = [];
globalThis.confirmAnswer = vi.fn(async () => true);

const db = {};
function seed() {
  Object.assign(db, {
    divisions: [{ id: 'd1', slug: 'freshers', name: 'Freshers', sort_order: 1 }, { id: 'd2', slug: 'wsl', name: 'WSL', sort_order: 2 }],
    seasons: [{ id: 's1', division_id: 'd1', slug: '2026', name: '2026', is_current: true, sort_order: 1 }, { id: 's0', division_id: 'd1', slug: '2025', name: '2025', is_current: false, sort_order: 0 }],
    teams: [{ id: 't1', name: 'Alpha' }, { id: 't2', name: 'Beta' }, { id: 't3', name: 'Gamma' }],
    team_entries: [{ id: 'e1', team_id: 't1', season_id: 's1' }, { id: 'e2', team_id: 't2', season_id: 's1' }, { id: 'e3', team_id: 't3', season_id: 's0' }],
    captain_assignments: [
      { id: 'a1', team_entry_id: 'e1', user_id: 'u-cap' },
      { id: 'a3', team_entry_id: 'e3', user_id: 'u-old' },
    ],
    accounts: [
      { user_id: 'u-cap', label: 'Cara Cap (cara@iiitkottayam.ac.in)' },
      { user_id: 'u-old', label: 'Olly Old (olly@iiitkottayam.ac.in)' },
      { user_id: 'u-ada1', label: 'Ada Lane (ada@iiitkottayam.ac.in)' },
      { user_id: 'u-ada2', label: 'Ada Lane (ada.l@iiitkottayam.ac.in)' },
    ],
    slowTeam: null,
    calls: [],
    rpcFail: null,
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
      const slow = table === 'captain_assignments' && q.single && db.slowTeam && q.filters.some(([c, v]) => c === 'team_entry_id' && v === db.slowTeam);
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
const rpc = async (name, args) => {
  if (name === 'assign_captain') {
    db.calls.push({ name, ...args });
    if (db.rpcFail) return { data: null, error: db.rpcFail };
    const existing = db.captain_assignments.find((a) => a.team_entry_id === args.p_entry);
    if (existing && !args.p_replace) return { data: null, error: { code: '23505', message: 'This team already has a captain' } };
    if (existing) existing.user_id = args.p_user;
    else db.captain_assignments.push({ id: `a-new-${db.calls.length}`, team_entry_id: args.p_entry, user_id: args.p_user });
    return { data: 'ok', error: null };
  }
  if (name === 'revoke_captain') {
    db.calls.push({ name, ...args });
    db.captain_assignments = db.captain_assignments.filter((a) => a.team_entry_id !== args.p_entry);
    return { data: null, error: null };
  }
  return directory(args);
};
const directory = async (args) => {
  if (args.p_ids) return { data: db.accounts.filter((a) => args.p_ids.includes(a.user_id)), error: null };
  const words = args.p_query.toLowerCase().split(/\s+/).filter(Boolean);
  return { data: db.accounts.filter((a) => words.every((w) => a.label.toLowerCase().includes(w))), error: null };
};
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (t) => from(t),
    rpc,
  },
}));
const { default: ManageCaptains } = await import('../ManageCaptains');
const { pick, optionsOf, trigger } = await import('./listbox');

beforeEach(() => {
  seed();
  globalThis.confirmAnswer = vi.fn(async () => true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const captainText = () => screen.getByRole('region', { name: 'Captain' }).textContent;
async function openTeam(team) {
  render(<ManageCaptains />);
  await waitFor(() => expect(trigger('Division').disabled).toBe(false));
  await pick('Division', 'Freshers');
  await waitFor(() => expect(trigger('Season').disabled).toBe(false));
  await pick('Season', '2026 (current)');
  await waitFor(() => expect(trigger('Team').disabled).toBe(false));
  if (team) await pick('Team', team);
}
async function chooseAccount(teamName, query, name) {
  fireEvent.change(screen.getByLabelText(`Find captain for ${teamName}`), { target: { value: query } });
  await waitFor(() => expect(trigger(`New captain for ${teamName}`).textContent).toMatch(/Choose from the search results/));
  await pick(`New captain for ${teamName}`, name);
}

describe('ManageCaptains', () => {
  it('offers each level only after the previous choice, and only that season’s teams', async () => {
    render(<ManageCaptains />);
    await waitFor(() => expect(trigger('Division').disabled).toBe(false));
    expect(await optionsOf('Division')).toEqual(['Freshers', 'WSL']);
    expect(trigger('Season').disabled).toBe(true);
    expect(trigger('Team').disabled).toBe(true);
    await pick('Division', 'WSL');
    await waitFor(() => expect(trigger('Season').textContent).toMatch('This division has no seasons'));
    await pick('Division', 'Freshers');
    await waitFor(() => expect(trigger('Season').disabled).toBe(false));
    expect(await optionsOf('Season')).toEqual(['2026 (current)', '2025']);
    await pick('Season', '2026 (current)');
    await waitFor(() => expect(trigger('Team').disabled).toBe(false));
    expect(await optionsOf('Team')).toEqual(['Alpha', 'Beta']);
    expect(screen.queryByRole('region', { name: 'Captain' })).toBeNull();
  });

  it('shows only the chosen team’s captain for the chosen season, by directory label', async () => {
    await openTeam('Alpha');
    await waitFor(() => expect(captainText()).toMatch(/Captain of Alpha in this season: Cara Cap \(cara@iiitkottayam\.ac\.in\)/));
    await pick('Team', 'Beta');
    await waitFor(() => expect(captainText()).toMatch(/Beta has no captain in this season/));
    expect(document.body.textContent).not.toMatch(/Cara Cap|u-cap|Olly/);
  });

  it('ignores a late answer for the previously chosen team', async () => {
    await openTeam();
    db.slowTeam = 'e1';
    await pick('Team', 'Alpha');
    await pick('Team', 'Beta');
    await waitFor(() => expect(captainText()).toMatch(/Beta has no captain/));
    await new Promise((r) => setTimeout(r, 120));
    expect(captainText()).toMatch(/Beta has no captain/);
    expect(captainText()).not.toMatch(/Cara/);
  });

  it('changes a captain by replacing the entry\'s one assignment, then shows the captain the database holds', async () => {
    await openTeam('Alpha');
    await waitFor(() => expect(captainText()).toMatch(/Cara Cap/));
    fireEvent.change(screen.getByLabelText('Find captain for Alpha'), { target: { value: 'ada lane' } });
    await waitFor(() => expect(trigger('New captain for Alpha').textContent).toMatch(/Choose from the search results/));
    expect(await optionsOf('New captain for Alpha')).toEqual(['Ada Lane (ada@iiitkottayam.ac.in)', 'Ada Lane (ada.l@iiitkottayam.ac.in)']);
    await pick('New captain for Alpha', 'Ada Lane (ada.l@iiitkottayam.ac.in)');
    fireEvent.click(screen.getByRole('button', { name: /change captain/i }));
    await waitFor(() => expect(captainText()).toMatch(/Captain of Alpha in this season: Ada Lane \(ada\.l@iiitkottayam\.ac\.in\)/));
    expect(db.calls).toEqual([{ name: 'assign_captain', p_entry: 'e1', p_user: 'u-ada2', p_replace: true }]);
    expect(db.captain_assignments.filter((a) => a.team_entry_id === 'e1')).toHaveLength(1);
    expect(globalThis.toasts.at(-1).description).toMatch(/Ada Lane \(ada\.l@iiitkottayam\.ac\.in\) is now the captain of Alpha/);
  });

  it('assigns a captain to a team without one, and offers accounts that captain another team too', async () => {
    await openTeam('Beta');
    await waitFor(() => expect(captainText()).toMatch(/Beta has no captain/));
    fireEvent.change(screen.getByLabelText('Find captain for Beta'), { target: { value: 'iiitkottayam' } });
    await waitFor(() => expect(trigger('New captain for Beta').textContent).toMatch(/Choose from the search results/));
    const offered = await optionsOf('New captain for Beta');
    expect(offered).toHaveLength(4);
    expect(offered.join()).toMatch(/Cara Cap/); // one person may captain several entries
    await pick('New captain for Beta', 'Ada Lane (ada@iiitkottayam.ac.in)');
    fireEvent.click(screen.getByRole('button', { name: /assign captain/i }));
    await waitFor(() => expect(captainText()).toMatch(/Captain of Beta in this season: Ada Lane \(ada@iiitkottayam\.ac\.in\)/));
    expect(db.calls).toEqual([{ name: 'assign_captain', p_entry: 'e2', p_user: 'u-ada1', p_replace: false }]);
  });

  it('revokes a captain and shows the team without one; a refused change keeps the database\'s captain', async () => {
    await openTeam('Alpha');
    await waitFor(() => expect(captainText()).toMatch(/Cara Cap/));
    await chooseAccount('Alpha', 'ada', 'Ada Lane (ada@iiitkottayam.ac.in)');
    db.rpcFail = { code: '22023', message: 'A captain cannot be assigned in a completed or archived season' };
    fireEvent.click(screen.getByRole('button', { name: /change captain/i }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/completed or archived season/);
    await waitFor(() => expect(captainText()).toMatch(/Cara Cap/));
    fireEvent.click(screen.getByRole('button', { name: /revoke captain/i }));
    await waitFor(() => expect(captainText()).toMatch(/Alpha has no captain in this season/));
    expect(db.captain_assignments.find((a) => a.id === 'a1')).toBeUndefined();
    expect(db.calls.at(-1)).toEqual({ name: 'revoke_captain', p_entry: 'e1' });
  });
});
