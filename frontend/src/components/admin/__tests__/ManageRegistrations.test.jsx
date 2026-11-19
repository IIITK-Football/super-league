// @vitest-environment jsdom
// Group: frontend-components. Captain assignment: the current captain is labelled through the dictator-only account
// directory (never a profile email or raw id); a captain is found by searching every word of a name or college email;
// accounts already captaining another team are not offered; short queries, no matches and errors are explained.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = { registrations: [], accounts: [], calls: [], fail: null };
const directory = async (args) => {
  db.calls.push(args);
  if (db.fail && !args.p_ids) return { data: null, error: db.fail };
  if (args.p_ids) return { data: db.accounts.filter((a) => args.p_ids.includes(a.user_id)), error: null };
  const words = args.p_query.toLowerCase().split(/\s+/).filter(Boolean);
  return { data: db.accounts.filter((a) => words.every((w) => a.label.toLowerCase().includes(w))), error: null };
};
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (_name, args) => directory(args),
    from: () => {
      const b = { select: () => b, order: async () => ({ data: db.registrations, error: null }) };
      return b;
    },
  },
}));
vi.mock('../../../hooks/useDivisions', () => ({ useDivisions: () => ({ divisions: [{ slug: 'freshers', name: 'Freshers' }] }) }));
const { default: ManageRegistrations } = await import('../ManageRegistrations');

beforeEach(() => {
  db.accounts = [
    { user_id: 'u-cap', label: 'Cara Cap (cara@iiitkottayam.ac.in)', role: 'captain' },
    { user_id: 'u-ada1', label: 'Ada Lane (ada@iiitkottayam.ac.in)', role: 'default' },
    { user_id: 'u-ada2', label: 'Ada Lane (ada.l@iiitkottayam.ac.in)', role: 'default' },
  ];
  db.registrations = [
    { id: 'r1', team_id: 't1', team_name: 'Alpha', season_id: 's1', season: { name: '2026', division: { slug: 'freshers' } }, captain_id: 'u-cap' },
    { id: 'r2', team_id: 't2', team_name: 'Beta', season_id: 's1', season: { name: '2026', division: { slug: 'freshers' } }, captain_id: null },
  ];
  db.calls = []; db.fail = null;
});
afterEach(cleanup);

const optionLabels = (select) => within(select).getAllByRole('option').map((o) => o.textContent);

describe('ManageRegistrations captain picker', () => {
  it('labels the current captain through the account directory, never by id', async () => {
    render(<ManageRegistrations />);
    const select = await screen.findByLabelText('Captain for Alpha');
    await waitFor(() => expect(select.selectedOptions[0].textContent).toBe('Cara Cap (cara@iiitkottayam.ac.in)'));
    expect(db.calls[0]).toMatchObject({ p_ids: ['u-cap'] });
    expect(document.body.textContent).not.toMatch(/u-cap/);
  });

  it('finds a captain by every word, tells same-name people apart, and leaves out other teams’ captains', async () => {
    render(<ManageRegistrations />);
    const find = await screen.findByLabelText('Find captain for Beta');
    fireEvent.change(find, { target: { value: 'a' } });
    expect(await screen.findByText('Type at least two letters.')).toBeTruthy();
    fireEvent.change(find, { target: { value: 'ada lane' } });
    await screen.findByText('2 accounts found');
    const select = screen.getByLabelText('Captain for Beta');
    expect(optionLabels(select)).toEqual(['Choose from the search results', 'Ada Lane (ada@iiitkottayam.ac.in)', 'Ada Lane (ada.l@iiitkottayam.ac.in)']);
    fireEvent.change(select, { target: { value: 'u-ada2' } });
    expect(select.value).toBe('u-ada2');
    fireEvent.change(find, { target: { value: 'cara' } });
    expect(await screen.findByText(/no free account matches/i)).toBeTruthy();
  });

  it('reports a failed search and can retry', async () => {
    db.fail = { message: 'permission denied' };
    render(<ManageRegistrations />);
    fireEvent.change(await screen.findByLabelText('Find captain for Beta'), { target: { value: 'ada' } });
    expect(await screen.findByText(/search failed \(permission denied\)/i)).toBeTruthy();
    db.fail = null;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('2 accounts found')).toBeTruthy();
  });
});
