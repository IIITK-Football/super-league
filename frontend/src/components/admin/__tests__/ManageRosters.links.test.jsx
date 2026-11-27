// @vitest-environment jsdom
// Group: frontend-components. The player account panel in Teams & Rosters: a linked player shows their account's
// email (read-only) with an Unlink that asks first and sends only the player; an unlinked player has no email and
// offers verified accounts found by email (one already linked elsewhere cannot be chosen), linking with exactly the
// RPC arguments and explaining each refusal.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlayerAccountLink from '../PlayerAccountLink';
// Confirmations are answered by globalThis.confirmAnswer (a vi.fn); the dialog itself is covered by the screens that use it.
vi.mock('../../ui', async (importOriginal) => ({ ...(await importOriginal()), useConfirm: () => globalThis.confirmAnswer }));
globalThis.confirmAnswer = vi.fn(async () => true);

const rpc = vi.fn();
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc: (...a) => rpc(...a) } }));

const player = { id: 'p1', first_name: 'Ada', last_name: 'Striker' };
const accounts = [
  { user_id: 'u1', email: 'ada@iiitkottayam.ac.in', linked_player_id: null },
  { user_id: 'u2', email: 'adam@iiitkottayam.ac.in', linked_player_id: 'p9', linked_player_name: 'Bo Keeper', linked_player_place: 'Beta · 2026 (WSL)' },
];
const typeSearch = async (text) => {
  vi.useFakeTimers();
  fireEvent.change(screen.getByLabelText('Link email search'), { target: { value: text } });
  await act(async () => { vi.advanceTimersByTime(300); });
  vi.useRealTimers();
};

beforeEach(() => { rpc.mockReset(); globalThis.confirmAnswer = vi.fn(async () => true); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the player account panel', () => {
  it('shows loading, then the linked email (read-only) with an Unlink that asks first and sends only the player', async () => {
    const onChanged = vi.fn();
    const { rerender } = render(<PlayerAccountLink player={player} status={null} onChanged={onChanged} />);
    expect(screen.getByText(/Loading the account link/)).toBeTruthy();
    rerender(<PlayerAccountLink player={player} status={{ linked: true, email: 'ada@iiitkottayam.ac.in' }} onChanged={onChanged} />);
    expect(screen.getByText(/Linked to/).textContent).toMatch(/ada@iiitkottayam.ac.in.*read-only/);
    expect(screen.queryByRole('textbox')).toBeNull();
    globalThis.confirmAnswer.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: /unlink/i }));
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: null });
    fireEvent.click(screen.getByRole('button', { name: /unlink/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/no longer linked/));
    expect(rpc).toHaveBeenCalledWith('unlink_player_account', { p_player: 'p1' });
    expect(onChanged).toHaveBeenCalled();
  });

  it('finds verified accounts by email, never offers one linked elsewhere, and links the chosen one', async () => {
    rpc.mockImplementation(async (name) => (name === 'verified_accounts_for_linking' ? { data: accounts, error: null } : { data: null, error: null }));
    const onChanged = vi.fn();
    render(<PlayerAccountLink player={player} status={{ linked: false, email: null, has_key: false }} onChanged={onChanged} />);
    expect(screen.getByText(/Not linked to an account, so this player has no email/)).toBeTruthy();
    await typeSearch('ad');
    const list = await screen.findByRole('list', { name: 'Link matches' });
    expect(rpc).toHaveBeenCalledWith('verified_accounts_for_linking', { p_query: 'ad' });
    expect(within(list).getByText(/Has a player: Bo Keeper · Beta/)).toBeTruthy();
    expect(within(list).queryByRole('button', { name: /adam@/ })).toBeNull();
    fireEvent.click(within(list).getByRole('button', { name: 'Link ada@iiitkottayam.ac.in' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/linked to ada@iiitkottayam.ac.in/));
    expect(rpc).toHaveBeenCalledWith('link_player_account', { p_player: 'p1', p_user: 'u1' });
    expect(onChanged).toHaveBeenCalled();
  });

  it('explains no matches, a failed search with retry, and each refusal', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    render(<PlayerAccountLink player={player} status={{ linked: false }} />);
    await typeSearch('zz');
    await waitFor(() => expect(screen.getByText(/No verified account matches/)).toBeTruthy());
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await typeSearch('zzz');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/search failed \(boom\)/));
    rpc.mockResolvedValueOnce({ data: accounts.slice(0, 1), error: null });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('list', { name: 'Link matches' });
    for (const [error, text] of [
      [{ code: '23514', message: 'Only a verified account can be linked to a player' }, /verified account/],
      [{ code: '23505', message: 'That account is already linked to another player' }, /already linked to another player/],
      [{ code: '42501', message: 'x' }, /Only a dictator/],
    ]) {
      rpc.mockResolvedValueOnce({ data: null, error });
      fireEvent.click(screen.getByRole('button', { name: 'Link ada@iiitkottayam.ac.in' }));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(text));
    }
  });

  it('reports a link status that could not be loaded', () => {
    render(<PlayerAccountLink player={player} status={null} statusError="offline" />);
    expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded \(offline\)/);
  });
});
