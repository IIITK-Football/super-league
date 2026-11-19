// @vitest-environment jsdom
// Group: frontend-components. The dictator's account-link controls in Teams & Rosters: the link panel shows the linked
// account or "Not linked", searches verified accounts (an account linked elsewhere cannot be chosen), links and unlinks
// (after confirmation) with exactly the RPC arguments, and explains refusals; the import previews a pasted file, offers
// Apply only after a clean preview of the same text, and reports what was linked or that nothing was.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlayerAccountLink from '../PlayerAccountLink';
import AccountLinkImport from '../AccountLinkImport';

const rpc = vi.fn();
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc: (...a) => rpc(...a) } }));

const player = { id: 'p1', first_name: 'Ada', last_name: 'Striker' };
const candidates = [
  { user_id: 'u1', label: 'Ada Striker (ada@iiitkottayam.ac.in)', linked_player_id: null, linked_player_name: null },
  { user_id: 'u2', label: 'Bo (bo@iiitkottayam.ac.in)', linked_player_id: 'p9', linked_player_name: 'Bo Keeper' },
];
const typeSearch = async (text) => {
  vi.useFakeTimers();
  fireEvent.change(screen.getByLabelText('Search accounts'), { target: { value: text } });
  await act(async () => { vi.advanceTimersByTime(300); });
  vi.useRealTimers();
};

beforeEach(() => { rpc.mockReset(); vi.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the player account link panel', () => {
  it('shows loading, then the linked account with an Unlink that asks first and sends only the player', async () => {
    const onChanged = vi.fn();
    const { rerender } = render(<PlayerAccountLink player={player} status={null} onChanged={onChanged} />);
    expect(screen.getByText(/Loading the account link/)).toBeTruthy();
    rerender(<PlayerAccountLink player={player} status={{ linked: true, account_label: 'Ada (ada@iiitkottayam.ac.in)' }} onChanged={onChanged} />);
    expect(screen.getByText(/Linked to/).textContent).toMatch(/ada@iiitkottayam/);
    window.confirm.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: /unlink/i }));
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: null });
    fireEvent.click(screen.getByRole('button', { name: /unlink/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/no longer linked/));
    expect(rpc).toHaveBeenCalledWith('unlink_player_account', { p_player: 'p1' });
    expect(onChanged).toHaveBeenCalled();
  });

  it('searches verified accounts, refuses to offer one linked elsewhere, and links the chosen one', async () => {
    rpc.mockImplementation(async (name) => (name === 'player_link_candidates' ? { data: candidates, error: null } : { data: null, error: null }));
    const onChanged = vi.fn();
    render(<PlayerAccountLink player={player} status={{ linked: false }} onChanged={onChanged} />);
    expect(screen.getByText('Not linked to an account.')).toBeTruthy();
    await typeSearch('ad');
    await waitFor(() => expect(screen.getByRole('list', { name: 'Matching accounts' })).toBeTruthy());
    expect(rpc).toHaveBeenCalledWith('player_link_candidates', { p_query: 'ad' });
    const list = screen.getByRole('list', { name: 'Matching accounts' });
    expect(within(list).getByText('Already linked to Bo Keeper')).toBeTruthy();
    expect(within(list).queryByRole('button', { name: /Link Bo/ })).toBeNull();
    fireEvent.click(within(list).getByRole('button', { name: /Link Ada Striker/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/linked to Ada Striker/));
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
    rpc.mockResolvedValueOnce({ data: candidates.slice(0, 1), error: null });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('list', { name: 'Matching accounts' })).toBeTruthy());
    for (const [error, text] of [
      [{ code: '23514', message: 'Only a verified account can be linked to a player' }, /verified account/],
      [{ code: '23505', message: 'That account is already linked to another player' }, /already linked to another player/],
      [{ code: '42501', message: 'x' }, /Only a dictator/],
    ]) {
      rpc.mockResolvedValueOnce({ data: null, error });
      fireEvent.click(screen.getByRole('button', { name: /Link Ada Striker/ }));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(text));
    }
  });

  it('reports a link status that could not be loaded', () => {
    render(<PlayerAccountLink player={player} status={null} statusError="offline" />);
    expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded \(offline\)/);
  });
});

describe('the account-link import', () => {
  const file = 'player_id,email\np1,ada@iiitkottayam.ac.in\np2,';
  const open = () => { render(<AccountLinkImport onApplied={onApplied} />); fireEvent.change(screen.getByLabelText('Account links file'), { target: { value: file } }); };
  const onApplied = vi.fn();
  const applyButton = () => screen.getByRole('button', { name: /apply/i });

  it('explains a malformed file without calling the database', async () => {
    render(<AccountLinkImport />);
    fireEvent.change(screen.getByLabelText('Account links file'), { target: { value: 'email,player_id\nx,y' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByRole('alert').textContent).toMatch(/header/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('previews each row and does not offer Apply while any row needs attention', async () => {
    rpc.mockResolvedValue({ data: [
      { n: 1, player_id: 'p1', email: 'ada@iiitkottayam.ac.in', status: 'ready', account_label: 'Ada' },
      { n: 2, player_id: 'p2', email: null, status: 'missing_email', account_label: null },
    ], error: null });
    open();
    expect(applyButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(screen.getByRole('table', { name: 'Account links preview' })).toBeTruthy());
    expect(rpc).toHaveBeenCalledWith('preview_player_account_links', { p_rows: [{ player_id: 'p1', email: 'ada@iiitkottayam.ac.in' }, { player_id: 'p2', email: '' }] });
    expect(screen.getByText(/1 to link, 0 already linked, 1 need attention/)).toBeTruthy();
    expect(screen.getByText('No email, and the player has no contact email')).toBeTruthy();
    expect(applyButton().disabled).toBe(true);
  });

  it('applies a clean preview of the same text, and asks for a new preview after an edit', async () => {
    rpc.mockImplementation(async (name) => (name === 'preview_player_account_links'
      ? { data: [{ n: 1, player_id: 'p1', status: 'ready', account_label: 'Ada' }, { n: 2, player_id: 'p2', status: 'already_linked', account_label: 'Bo' }], error: null }
      : { data: 1, error: null }));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(applyButton().disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('Account links file'), { target: { value: `${file}\n` } });
    expect(applyButton().disabled).toBe(true);
    expect(screen.getByText(/changed since the preview/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Account links file'), { target: { value: file } });
    await waitFor(() => expect(applyButton().disabled).toBe(false));
    fireEvent.click(applyButton());
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/1 player linked/));
    expect(rpc).toHaveBeenLastCalledWith('apply_player_account_links', { p_rows: [{ player_id: 'p1', email: 'ada@iiitkottayam.ac.in' }, { player_id: 'p2', email: '' }] });
    expect(onApplied).toHaveBeenCalled();
  });

  it('says nothing was linked when the database refuses the apply', async () => {
    rpc.mockImplementation(async (name) => (name === 'preview_player_account_links'
      ? { data: [{ n: 1, player_id: 'p1', status: 'ready', account_label: 'Ada' }], error: null }
      : { data: null, error: { code: 'P0001', message: '1 row(s) need attention; nothing was linked.' } }));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(applyButton().disabled).toBe(false));
    fireEvent.click(applyButton());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Nothing was linked/));
  });
});
