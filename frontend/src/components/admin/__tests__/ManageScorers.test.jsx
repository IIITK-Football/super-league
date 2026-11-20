// @vitest-environment jsdom
// Group: frontend-components. Scorers: assignments are listed with the person's directory label (never an id), with
// loading, empty and error-with-retry states; a scorer is assigned to a season or to one match with an optional expiry
// through assign_scorer; assigning someone who captains a team in that season or match shows a warning; revoking calls
// revoke_scorer and reloads; a refusal from the database is shown.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = {};
function seed() {
  Object.assign(db, {
    divisions: [{ id: 'd1', name: 'Freshers', sort_order: 1 }],
    seasons: [{ id: 's1', division_id: 'd1', name: '2026', is_current: true, sort_order: 1 }],
    matches: [{ id: 'm1', season_id: 's1', date: '2026-12-01T10:00:00Z', status: 'scheduled', home: { id: 't1', name: 'Alpha' }, away: { id: 't2', name: 'Beta' } }],
    scorer_assignments: [{ id: 'a1', user_id: 'u1', season_id: 's1', match_id: null, expires_at: null, season: { name: '2026', division: { name: 'Freshers' } }, match: null }],
    captain_assignments: [{ user_id: 'u2', team_entry: { team_id: 't1', season_id: 's1', team: { name: 'Alpha' } } }],
    accounts: [
      { user_id: 'u1', label: 'Sam Scorer (sam@iiitkottayam.ac.in)' },
      { user_id: 'u2', label: 'Cara Cap (cara@iiitkottayam.ac.in)' },
    ],
    calls: [], rpcError: null, listError: null,
  });
}
function from(table) {
  const b = {
    select: () => b, order: () => b, eq: (c, v) => { b.f = [c, v]; return b; },
    then: (resolve, reject) => Promise.resolve().then(() => {
      if (table === 'scorer_assignments' && db.listError) return { data: null, error: db.listError };
      const rows = (db[table] || []).filter((r) => !b.f || r[b.f[0]] === v(b.f[1], r, b.f[0]));
      return { data: rows, error: null };
    }).then(resolve, reject),
  };
  return b;
}
const v = (value) => value;
const rpc = async (name, args) => {
  if (name === 'account_directory') {
    if (args.p_ids) return { data: db.accounts.filter((a) => args.p_ids.includes(a.user_id)), error: null };
    const words = args.p_query.toLowerCase().split(/\s+/).filter(Boolean);
    return { data: db.accounts.filter((a) => words.every((w) => a.label.toLowerCase().includes(w))), error: null };
  }
  db.calls.push({ name, ...args });
  if (db.rpcError) return { data: null, error: db.rpcError };
  if (name === 'assign_scorer') db.scorer_assignments.push({ id: `a-${db.calls.length}`, user_id: args.p_user, season_id: args.p_season, match_id: args.p_match, expires_at: args.p_expires_at, season: { name: '2026', division: { name: 'Freshers' } }, match: args.p_match ? db.matches[0] : null });
  if (name === 'revoke_scorer') db.scorer_assignments = db.scorer_assignments.filter((r) => r.id !== args.p_assignment);
  return { data: 'ok', error: null };
};
vi.mock('../../../lib/supabase', () => ({ supabase: { from, rpc } }));
const { default: ManageScorers } = await import('../ManageScorers');

beforeEach(() => { seed(); vi.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const pick = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
async function fill(query, accountId) {
  fireEvent.change(screen.getByLabelText('Find scorer'), { target: { value: query } });
  await waitFor(() => expect(within(screen.getByLabelText('Scorer')).getAllByRole('option').length).toBeGreaterThan(1));
  pick('Scorer', accountId);
  pick('Division', 'd1');
  await waitFor(() => expect(screen.getByRole('option', { name: '2026 (current)' })).toBeTruthy());
  pick('Season', 's1');
}

describe('ManageScorers', () => {
  it('lists assignments by directory label with their scope, and shows the empty state', async () => {
    render(<ManageScorers />);
    const list = await screen.findByRole('list', { name: 'Scorer assignments' });
    expect(within(list).getByText('Sam Scorer (sam@iiitkottayam.ac.in)')).toBeTruthy();
    expect(list.textContent).toMatch(/Every match of Freshers 2026/);
    expect(list.textContent).toMatch(/No expiry/);
    expect(document.body.textContent).not.toMatch(/\bu1\b/);
    cleanup(); db.scorer_assignments = [];
    render(<ManageScorers />);
    expect(await screen.findByText('No scorers are assigned yet.')).toBeTruthy();
  });

  it('reports a failed load and can retry', async () => {
    db.listError = { message: 'permission denied' };
    render(<ManageScorers />);
    expect(await screen.findByText(/Assignments could not be loaded \(permission denied\)/)).toBeTruthy();
    db.listError = null;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('list', { name: 'Scorer assignments' })).toBeTruthy();
  });

  it('assigns a scorer to a whole season, then reloads the list', async () => {
    render(<ManageScorers />);
    await screen.findByRole('list', { name: 'Scorer assignments' });
    await fill('sam', 'u1');
    fireEvent.click(screen.getByRole('button', { name: /assign scorer/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/can now score every match of the season/));
    expect(db.calls).toEqual([{ name: 'assign_scorer', p_user: 'u1', p_season: 's1', p_match: null, p_expires_at: null }]);
  });

  it('assigns a scorer to one match with an expiry', async () => {
    render(<ManageScorers />);
    await screen.findByRole('list', { name: 'Scorer assignments' });
    await fill('sam', 'u1');
    await waitFor(() => expect(screen.getByRole('option', { name: /Alpha vs Beta/ })).toBeTruthy());
    pick('Match', 'm1');
    fireEvent.change(screen.getByLabelText('Expires'), { target: { value: '2030-01-01T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: /assign scorer/i }));
    await waitFor(() => expect(db.calls).toHaveLength(1));
    expect(db.calls[0]).toMatchObject({ name: 'assign_scorer', p_user: 'u1', p_season: null, p_match: 'm1' });
    expect(db.calls[0].p_expires_at).toMatch(/^2030-01-01T/);
  });

  it('warns, without blocking, when the scorer captains a team in that match', async () => {
    render(<ManageScorers />);
    await screen.findByRole('list', { name: 'Scorer assignments' });
    await fill('cara', 'u2');
    await waitFor(() => expect(screen.getByRole('option', { name: /Alpha vs Beta/ })).toBeTruthy());
    pick('Match', 'm1');
    expect((await screen.findByRole('note')).textContent).toMatch(/Cara Cap.* captains Alpha in this match.*explicit assignment/);
    expect(screen.getByRole('button', { name: /assign scorer/i }).disabled).toBe(false);
  });

  it('shows the database refusal and keeps the list', async () => {
    db.rpcError = { code: '42501', message: 'Only a dictator can assign scorers' };
    render(<ManageScorers />);
    await screen.findByRole('list', { name: 'Scorer assignments' });
    await fill('sam', 'u1');
    fireEvent.click(screen.getByRole('button', { name: /assign scorer/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Only a dictator can assign scorers/);
  });

  it('revokes an assignment after confirming, and shows the empty state', async () => {
    render(<ManageScorers />);
    await screen.findByRole('list', { name: 'Scorer assignments' });
    fireEvent.click(screen.getByRole('button', { name: /revoke/i }));
    await screen.findByText('No scorers are assigned yet.');
    expect(db.calls).toEqual([{ name: 'revoke_scorer', p_assignment: 'a1' }]);
  });
});
