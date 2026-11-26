// @vitest-environment jsdom
// Group: frontend-components. Access control finds accounts through the dictator-only account directory: labels are
// the directory's (verified email with the name as context), never a profile email or raw id; search is debounced and
// only the newest answer is shown; loading, no-match and error-with-retry states; roles are independent grants (one
// checkbox per role), granted and removed one at a time, with a hint when a captain or scorer grant has no assignment.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = { accounts: [], calls: [], fail: null, slow: null, writes: [], removed: [], assignments: { captain_assignments: [], scorer_assignments: [] }, writeError: null };
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
    from: (table) => ({
      select: async () => ({ data: db.assignments[table] ?? [], error: null }),
      insert: async (row) => { db.writes.push(row); return { error: db.writeError }; },
      delete: () => { const filters = {}; const chain = { eq: (k, v) => { filters[k] = v; return Object.keys(filters).length < 2 ? chain : Promise.resolve((db.removed.push({ ...filters }), { error: db.writeError })); } }; return chain; },
    }),
  },
}));
const { default: ManageRoles } = await import('../ManageRoles');
const { ConfirmProvider } = await import('../../ui');
const renderRoles = () => render(<ConfirmProvider><ManageRoles currentUserId="me" /></ConfirmProvider>);

beforeEach(() => {
  db.accounts = [
    { user_id: 'u1', label: 'Ada Lane (ada@iiitkottayam.ac.in)', roles: [] },
    { user_id: 'u2', label: 'Ada Lane (ada.l@iiitkottayam.ac.in)', roles: ['captain', 'editor'] },
    { user_id: 'me', label: 'boss@iiitkottayam.ac.in', roles: ['dictator'] },
  ];
  db.calls = []; db.fail = null; db.slow = null; db.writes = []; db.removed = []; db.writeError = null;
  db.assignments = { captain_assignments: [], scorer_assignments: [] };
});
afterEach(cleanup);

const rows = () => within(screen.getByRole('list', { name: 'Accounts' })).getAllByRole('listitem');

describe('ManageRoles', () => {
  it('lists accounts by their directory label, with one checkbox per independent role', async () => {
    renderRoles();
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(screen.getByText('3 accounts')).toBeTruthy();
    const boxes = (label) => ['Captain', 'Scorer', 'Editor', 'Dictator'].map((r) => screen.getByLabelText(`${r} for ${label}`).checked);
    expect(boxes('Ada Lane (ada.l@iiitkottayam.ac.in)')).toEqual([true, false, true, false]); // several grants at once
    expect(boxes('Ada Lane (ada@iiitkottayam.ac.in)')).toEqual([false, false, false, false]); // a normal user holds none
    expect(document.body.textContent).not.toMatch(/\bu1\b|\bu2\b/);
  });

  it('searches every word after typing pauses, and shows a clear no-match message', async () => {
    renderRoles();
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.change(screen.getByLabelText('Search accounts'), { target: { value: 'ada ada.l' } });
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(db.calls.at(-1)).toMatchObject({ p_query: 'ada ada.l' });
    fireEvent.change(screen.getByLabelText('Search accounts'), { target: { value: 'nobody' } });
    expect(await screen.findByText('No account matches “nobody”.')).toBeTruthy();
  });

  it('shows only the newest answer when an earlier search answers late', async () => {
    renderRoles();
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
    renderRoles();
    expect(await screen.findByText(/accounts could not be loaded/i)).toBeTruthy();
    db.fail = null;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(rows()).toHaveLength(3));
  });

  it('grants and removes one role at a time, confirms by the account label, and keeps the dictator from removing their own', async () => {
    renderRoles();
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(screen.getByLabelText('Editor for Ada Lane (ada@iiitkottayam.ac.in)'));
    expect(await screen.findByText('Granted editor for Ada Lane (ada@iiitkottayam.ac.in).')).toBeTruthy();
    expect(db.writes).toEqual([{ user_id: 'u1', role: 'editor' }]);
    expect(screen.getByLabelText('Editor for Ada Lane (ada@iiitkottayam.ac.in)').checked).toBe(true);
    fireEvent.click(screen.getByLabelText('Editor for Ada Lane (ada.l@iiitkottayam.ac.in)'));
    expect(await screen.findByText('Removed editor for Ada Lane (ada.l@iiitkottayam.ac.in).')).toBeTruthy();
    expect(db.removed).toEqual([{ user_id: 'u2', role: 'editor' }]);
    expect(screen.getByLabelText('Captain for Ada Lane (ada.l@iiitkottayam.ac.in)').checked).toBe(true); // other grants untouched
    fireEvent.click(screen.getByLabelText('Dictator for boss@iiitkottayam.ac.in'));
    expect(await screen.findByText(/cannot remove your own dictator access/i)).toBeTruthy();
    expect(db.removed).toHaveLength(1);
  });

  it('shows the database message when a grant is refused, and does not change the box', async () => {
    db.writeError = { message: 'new row violates row-level security policy for table "user_roles"' };
    renderRoles();
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(screen.getByLabelText('Scorer for Ada Lane (ada@iiitkottayam.ac.in)'));
    expect(await screen.findByText(/row-level security/)).toBeTruthy();
    expect(screen.getByLabelText('Scorer for Ada Lane (ada@iiitkottayam.ac.in)').checked).toBe(false);
  });

  it('says when a captain or scorer grant has no assignment, and not when it has one', async () => {
    db.assignments.captain_assignments = [{ user_id: 'u2' }];
    renderRoles();
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(screen.queryByText(/Captain role without an assignment/)).toBeNull();
    fireEvent.click(screen.getByLabelText('Scorer for Ada Lane (ada@iiitkottayam.ac.in)'));
    expect(await screen.findByText(/Scorer role without an assignment/)).toBeTruthy();
  });

  it('asks before making someone a dictator, naming them, and writes only on confirm', async () => {
    renderRoles();
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(screen.getByLabelText('Dictator for Ada Lane (ada@iiitkottayam.ac.in)'));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Ada Lane \(ada@iiitkottayam\.ac\.in\)/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(db.writes).toEqual([]);
    expect(screen.getByLabelText('Dictator for Ada Lane (ada@iiitkottayam.ac.in)').checked).toBe(false);
    fireEvent.click(screen.getByLabelText('Dictator for Ada Lane (ada@iiitkottayam.ac.in)'));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Make dictator' }));
    expect(await screen.findByText('Granted dictator for Ada Lane (ada@iiitkottayam.ac.in).')).toBeTruthy();
    expect(db.writes).toEqual([{ user_id: 'u1', role: 'dictator' }]);
  });
});
