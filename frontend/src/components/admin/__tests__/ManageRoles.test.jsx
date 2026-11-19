// @vitest-environment jsdom
// Group: frontend-components. Access control finds accounts through the dictator-only account directory: labels are
// the directory's (verified email with the name as context), never a profile email or raw id; search is debounced and
// only the newest answer is shown; loading, no-match and error-with-retry states; only the agreed roles are offered.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = { accounts: [], calls: [], fail: null, slow: null, writes: [] };
const directory = async (args) => {
  db.calls.push(args);
  if (db.slow && args.p_query === db.slow) await new Promise((r) => setTimeout(r, 400));
  if (db.fail) return { data: null, error: db.fail };
  const words = (args.p_query || '').toLowerCase().split(/\s+/).filter(Boolean);
  return { data: db.accounts.filter((a) => words.every((w) => a.label.toLowerCase().includes(w))), error: null };
};
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (name, args) => (name === 'account_directory' ? directory(args) : Promise.resolve({ data: null, error: { message: 'unexpected' } })),
    from: () => ({ upsert: async (row) => { db.writes.push(row); return { error: null }; } }),
  },
}));
const { default: ManageRoles } = await import('../ManageRoles');

beforeEach(() => {
  db.accounts = [
    { user_id: 'u1', label: 'Ada Lane (ada@iiitkottayam.ac.in)', role: 'default' },
    { user_id: 'u2', label: 'Ada Lane (ada.l@iiitkottayam.ac.in)', role: 'captain' },
    { user_id: 'me', label: 'boss@iiitkottayam.ac.in', role: 'dictator' },
  ];
  db.calls = []; db.fail = null; db.slow = null; db.writes = [];
});
afterEach(cleanup);

const rows = () => within(screen.getByRole('list', { name: 'Accounts' })).getAllByRole('listitem');

describe('ManageRoles', () => {
  it('lists accounts by their directory label, distinguishing same-name people, with only the agreed roles', async () => {
    render(<ManageRoles currentUserId="me" />);
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(screen.getByText('3 accounts')).toBeTruthy();
    const select = screen.getByLabelText('Role for Ada Lane (ada.l@iiitkottayam.ac.in)');
    expect(select.value).toBe('captain');
    expect(within(select).getAllByRole('option').map((o) => o.value)).toEqual(['default', 'captain', 'editor', 'dictator']);
    expect(document.body.textContent).not.toMatch(/\bu1\b|\bu2\b/);
  });

  it('searches every word after typing pauses, and shows a clear no-match message', async () => {
    render(<ManageRoles currentUserId="me" />);
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.change(screen.getByLabelText('Search accounts'), { target: { value: 'ada ada.l' } });
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(db.calls.at(-1)).toMatchObject({ p_query: 'ada ada.l' });
    fireEvent.change(screen.getByLabelText('Search accounts'), { target: { value: 'nobody' } });
    expect(await screen.findByText('No account matches “nobody”.')).toBeTruthy();
  });

  it('shows only the newest answer when an earlier search answers late', async () => {
    render(<ManageRoles currentUserId="me" />);
    await waitFor(() => expect(rows()).toHaveLength(3));
    db.slow = 'boss';
    fireEvent.change(screen.getByLabelText('Search accounts'), { target: { value: 'boss' } });
    await waitFor(() => expect(db.calls.at(-1)?.p_query).toBe('boss'));
    fireEvent.change(screen.getByLabelText('Search accounts'), { target: { value: 'ada.l' } });
    await waitFor(() => expect(rows()).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 500));
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toMatch(/ada\.l@/);
  });

  it('reports a failed search and can retry', async () => {
    db.fail = { message: 'permission denied' };
    render(<ManageRoles currentUserId="me" />);
    expect(await screen.findByText(/accounts could not be loaded/i)).toBeTruthy();
    db.fail = null;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(rows()).toHaveLength(3));
  });

  it('changes a role and confirms it by the account label; keeps the dictator from demoting themself', async () => {
    render(<ManageRoles currentUserId="me" />);
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.change(screen.getByLabelText('Role for Ada Lane (ada@iiitkottayam.ac.in)'), { target: { value: 'editor' } });
    expect(await screen.findByText('Role updated for Ada Lane (ada@iiitkottayam.ac.in).')).toBeTruthy();
    expect(db.writes).toEqual([{ user_id: 'u1', role: 'editor' }]);
    expect(screen.getByLabelText('Role for Ada Lane (ada@iiitkottayam.ac.in)').value).toBe('editor');
    fireEvent.change(screen.getByLabelText('Role for boss@iiitkottayam.ac.in'), { target: { value: 'default' } });
    expect(await screen.findByText(/cannot remove your own dictator access/i)).toBeTruthy();
    expect(db.writes).toHaveLength(1);
  });
});
