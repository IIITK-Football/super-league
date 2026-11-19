// @vitest-environment jsdom
// Group: frontend-components. The dictator's account matching and manual link in Teams & Rosters, against a fake
// Data API. Matching: loading, error with retry, empty, counts per case, "Link all ready matches" sending exactly the
// previewed ready pairs (after confirmation) and reporting what was linked and what was skipped, dismissing a waiting
// email. Manual link: a verified account found by email, then Division -> Season -> Team -> Player offering only players
// without an account, linking with exactly the RPC arguments.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const tables = {
  divisions: [{ id: 'd1', slug: 'wsl', name: 'WSL' }],
  seasons: [{ id: 's1', division_id: 'd1', slug: '2026', name: '2026', is_current: true }],
  team_entries: [{ id: 'e1', team_id: 't1', season_id: 's1' }],
  teams: [{ id: 't1', name: 'Alpha' }],
  roster_memberships: [{ player_id: 'p1', team_entry_id: 'e1', jersey_number: 9, position: 'ST' }, { player_id: 'p2', team_entry_id: 'e1', jersey_number: 4, position: 'CB' }],
  players: [{ id: 'p1', first_name: 'Ada', last_name: 'Striker' }, { id: 'p2', first_name: 'Ben', last_name: 'Back' }],
};
function from(table) {
  const filters = [];
  const b = {
    select: () => b, order: () => b,
    eq: (c, v) => { filters.push((r) => r[c] === v); return b; },
    in: (c, vs) => { filters.push((r) => vs.includes(r[c])); return b; },
    then: (resolve, reject) => Promise.resolve({ data: tables[table].filter((r) => filters.every((f) => f(r))), error: null }).then(resolve, reject),
  };
  return b;
}
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc: (...a) => rpc(...a), from: (t) => from(t) } }));

import AccountMatches from '../AccountMatches';
import ManualLink from '../ManualLink';

const rows = [
  { player_id: 'p1', player_name: 'Ada Striker', player_place: 'Alpha · 2026 (WSL)', email: 'ada@iiitkottayam.ac.in', user_id: 'u1', status: 'ready' },
  { player_id: 'p2', player_name: 'Ben Back', player_place: null, email: 'ben@iiitkottayam.ac.in', user_id: 'u2', status: 'ready' },
  { player_id: 'p3', player_name: 'Cy One', player_place: null, email: 'cy@iiitkottayam.ac.in', user_id: null, status: 'duplicate' },
  { player_id: 'p4', player_name: 'Cy Two', player_place: null, email: 'cy@iiitkottayam.ac.in', user_id: null, status: 'duplicate' },
  { player_id: 'p5', player_name: 'Dee Wait', player_place: null, email: 'dee@iiitkottayam.ac.in', user_id: 'u5', status: 'waiting_verification' },
  { player_id: 'p6', player_name: 'Eve Taken', player_place: null, email: 'eve@iiitkottayam.ac.in', user_id: 'u6', status: 'conflict' },
  { player_id: 'p7', player_name: 'Fay Nobody', player_place: null, email: 'fay@iiitkottayam.ac.in', user_id: null, status: 'no_account' },
];

beforeEach(() => { rpc.mockReset(); vi.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('account matching', () => {
  it('shows loading, then counts for every case and the rows, ready first', async () => {
    let resolve;
    rpc.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    render(<AccountMatches />);
    expect(screen.getByText(/Loading matches/)).toBeTruthy();
    await act(async () => resolve({ data: rows, error: null }));
    const counts = screen.getByRole('list', { name: 'Match counts' }).textContent;
    expect(counts).toMatch(/Ready to link: 2.*Duplicate: 2.*Conflict: 1.*Waiting for verification: 1.*No account yet: 1/);
    const table = screen.getByRole('table', { name: 'Account matches' });
    expect(within(table).getAllByRole('row')[1].textContent).toMatch(/Ada Striker.*Ready to link/);
    expect(screen.getByRole('button', { name: /Link all 2 ready matches/ }).disabled).toBe(false);
  });

  it('links exactly the previewed ready pairs after confirming, and reports skipped ones', async () => {
    rpc.mockImplementation(async (name) => (name === 'account_link_matches' ? { data: rows, error: null } : { data: { linked: 1, skipped: [{ player_id: 'p2', status: 'changed' }] }, error: null }));
    const onChanged = vi.fn();
    render(<AccountMatches onChanged={onChanged} />);
    const button = await screen.findByRole('button', { name: /Link all 2 ready matches/ });
    window.confirm.mockReturnValueOnce(false);
    fireEvent.click(button);
    expect(rpc).not.toHaveBeenCalledWith('apply_account_link_matches', expect.anything());
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/1 player linked\. 1 changed since the preview and was skipped/));
    expect(rpc).toHaveBeenCalledWith('apply_account_link_matches', { p_expected: [{ player_id: 'p1', user_id: 'u1' }, { player_id: 'p2', user_id: 'u2' }] });
    expect(onChanged).toHaveBeenCalled();
  });

  it('says nothing was linked when apply is refused, and dismisses a waiting email', async () => {
    rpc.mockImplementation(async (name) => {
      if (name === 'account_link_matches') return { data: rows, error: null };
      if (name === 'apply_account_link_matches') return { data: null, error: { code: '42501', message: 'x' } };
      return { data: null, error: null };
    });
    render(<AccountMatches />);
    fireEvent.click(await screen.findByRole('button', { name: /Link all 2 ready matches/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Only a dictator.*Nothing was linked/));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Fay Nobody' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/waiting email of Fay Nobody was dismissed/));
    expect(rpc).toHaveBeenCalledWith('dismiss_player_link_key', { p_player: 'p7' });
    expect(screen.queryByRole('button', { name: 'Dismiss Ada Striker' })).toBeNull(); // ready rows are linked, not dismissed
  });

  it('reports a load failure with retry, and an empty state', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'x' } }).mockResolvedValueOnce({ data: [], error: null });
    render(<AccountMatches />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded \(Only a dictator/));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('No players are waiting for an account.')).toBeTruthy());
  });
});

describe('manual link', () => {
  it('chooses a verified account by email, then a player without an account through the rosters, and links it', async () => {
    rpc.mockImplementation(async (name, args) => {
      if (name === 'verified_accounts_for_linking') return { data: [{ user_id: 'u9', email: 'ben@iiitkottayam.ac.in', linked_player_id: null }], error: null };
      if (name === 'player_link_status') return { data: args.p_player_ids.map((id) => ({ player_id: id, linked: id === 'p1' })), error: null };
      return { data: null, error: null };
    });
    const onChanged = vi.fn();
    render(<ManualLink onChanged={onChanged} />);
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText('Manual email search'), { target: { value: 'ben' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    vi.useRealTimers();
    fireEvent.click(within(await screen.findByRole('list', { name: 'Manual matches' })).getByRole('button', { name: 'Choose ben@iiitkottayam.ac.in' }));
    expect(screen.getByText(/Account:/).textContent).toMatch(/ben@iiitkottayam.ac.in/);
    await waitFor(() => expect(screen.getByRole('option', { name: 'WSL' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Link division'), { target: { value: 'd1' } });
    await waitFor(() => expect(screen.getByRole('option', { name: '2026 (current)' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Link season'), { target: { value: 's1' } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Alpha' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Link team'), { target: { value: 'e1' } });
    await waitFor(() => expect(screen.getByRole('option', { name: /Choose a player without an account \(1\)/ })).toBeTruthy());
    expect(screen.queryByRole('option', { name: /Ada Striker/ })).toBeNull(); // already linked
    fireEvent.change(screen.getByLabelText('Link player'), { target: { value: 'p2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link Ben Back' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Ben Back is linked to ben@iiitkottayam.ac.in, in every season/));
    expect(rpc).toHaveBeenCalledWith('link_player_account', { p_player: 'p2', p_user: 'u9' });
    expect(onChanged).toHaveBeenCalled();
  });

  it('explains a refused link', async () => {
    rpc.mockImplementation(async (name, args) => {
      if (name === 'verified_accounts_for_linking') return { data: [{ user_id: 'u9', email: 'ben@iiitkottayam.ac.in', linked_player_id: null }], error: null };
      if (name === 'player_link_status') return { data: args.p_player_ids.map((id) => ({ player_id: id, linked: false })), error: null };
      if (name === 'link_player_account') return { data: null, error: { code: '23505', message: 'That account is already linked to another player' } };
      return { data: null, error: null };
    });
    render(<ManualLink />);
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText('Manual email search'), { target: { value: 'ben' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    vi.useRealTimers();
    fireEvent.click(within(await screen.findByRole('list', { name: 'Manual matches' })).getByRole('button', { name: 'Choose ben@iiitkottayam.ac.in' }));
    await waitFor(() => expect(screen.getByRole('option', { name: 'WSL' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Link division'), { target: { value: 'd1' } });
    await waitFor(() => screen.getByRole('option', { name: '2026 (current)' }));
    fireEvent.change(screen.getByLabelText('Link season'), { target: { value: 's1' } });
    await waitFor(() => screen.getByRole('option', { name: 'Alpha' }));
    fireEvent.change(screen.getByLabelText('Link team'), { target: { value: 'e1' } });
    await waitFor(() => screen.getByRole('option', { name: /Ben Back/ }));
    fireEvent.change(screen.getByLabelText('Link player'), { target: { value: 'p2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link Ben Back' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/already linked to another player/));
  });
});
