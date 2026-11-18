// @vitest-environment jsdom
// Group: frontend-components. The dictator's audit history view against an in-memory Data API fake: loading, empty,
// success and error states, the table and actor filters, readable summaries (only changed fields for an update, a
// private field never shown) and paging. The real path is AuditHistory.local.test.jsx (audit group).
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = { rows: [], profiles: [], calls: [], fail: null };

function from(table) {
  const q = { filters: [], range: null, ins: null };
  const b = {
    select: () => b,
    order: () => b,
    eq: (c, v) => { q.filters.push([c, v]); return b; },
    in: (c, v) => { q.ins = [c, v]; return b; },
    range: (a, z) => { q.range = [a, z]; return b; },
    then: (resolve, reject) => Promise.resolve().then(() => {
      db.calls.push({ table, filters: q.filters, range: q.range });
      if (table === 'user_profiles') return { data: db.profiles.filter((p) => q.ins[1].includes(p.id)), error: null };
      if (db.fail) return { data: null, error: db.fail };
      const rows = db.rows.filter((r) => q.filters.every(([c, v]) => r[c] === v));
      return { data: q.range ? rows.slice(q.range[0], q.range[1] + 1) : rows, error: null };
    }).then(resolve, reject),
  };
  return b;
}
vi.mock('../../../lib/supabase', () => ({ supabase: { from: (t) => from(t) } }));

import AuditHistory, { PAGE_SIZE, describeActor, summarize } from '../AuditHistory';

const entry = (over) => ({ id: 1, occurred_at: '2026-11-18T10:00:00Z', actor_id: 'u1', actor_role: 'authenticated', action: 'update', table_name: 'divisions', record_id: 'd1', changes: {}, ...over });

beforeEach(() => {
  db.rows = [
    entry({ id: 3, changes: { name: { from: 'Inter', to: 'Inter League' } } }),
    entry({ id: 2, actor_id: 'u2', table_name: 'user_roles', record_id: 'u9', changes: { role: { from: 'default', to: 'captain' } } }),
    entry({ id: 1, actor_id: null, actor_role: 'postgres', action: 'insert', table_name: 'seasons', record_id: 's1', changes: { name: '2026', slug: '2026', archived_at: null } }),
  ];
  db.profiles = [{ id: 'u1', email: 'lamb@iiitkottayam.ac.in' }, { id: 'u2', email: 'diana@iiitkottayam.ac.in' }];
  db.calls = [];
  db.fail = null;
});
afterEach(cleanup);

describe('summaries', () => {
  it('lists changed fields for an update and recorded values for an insert, hiding private values', () => {
    expect(summarize(entry({ changes: { name: { from: 'A', to: 'B' }, email: { changed: true } } }))).toEqual(['email: changed (private)', 'name: A → B']);
    expect(summarize(entry({ action: 'insert', changes: { slug: 'x', starts_on: null, attributes: { pace: 80 } } }))).toEqual(['attributes: {"pace":80}', 'slug: x']);
    expect(summarize(entry({ action: 'insert', changes: { email: '[redacted]' } }))).toEqual(['email: [redacted]']);
  });

  it('names the actor by email, or the server and system sessions', () => {
    expect(describeActor(entry({}), { u1: 'lamb@iiitkottayam.ac.in' })).toBe('lamb@iiitkottayam.ac.in');
    expect(describeActor(entry({ actor_id: null, actor_role: 'service_role' }), {})).toBe('Server');
    expect(describeActor(entry({ actor_id: null, actor_role: 'postgres' }), {})).toBe('System (postgres)');
  });
});

describe('AuditHistory', () => {
  it('shows loading, then the newest changes with actor, action, table and summary', async () => {
    render(<AuditHistory />);
    expect(screen.getByText(/loading the audit history/i)).toBeTruthy();
    const list = await screen.findByRole('list', { name: 'Audit entries' });
    const items = within(list).getAllByRole('listitem').filter((li) => li.parentElement === list);
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toMatch(/lamb@iiitkottayam\.ac\.in.*update.*Divisions.*name: Inter → Inter League/);
    expect(items[1].textContent).toMatch(/diana@iiitkottayam\.ac\.in.*Roles.*role: default → captain/);
    expect(items[2].textContent).toMatch(/System \(postgres\).*insert.*Seasons/);
    expect(db.calls[0]).toMatchObject({ table: 'audit_log', range: [0, PAGE_SIZE - 1] });
  });

  it('filters by table and by the person who made the change', async () => {
    render(<AuditHistory />);
    await screen.findByRole('list', { name: 'Audit entries' });
    fireEvent.change(screen.getByLabelText('Table'), { target: { value: 'user_roles' } });
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Audit entries' })).getAllByText(/role: default → captain/)).toHaveLength(1));
    expect(db.calls.at(-1)?.table === 'audit_log' ? db.calls.at(-1).filters : db.calls.at(-2).filters).toEqual([['table_name', 'user_roles']]);
    fireEvent.change(screen.getByLabelText('Table'), { target: { value: '' } });
    await waitFor(() => expect(within(screen.getByLabelText('Changed by')).getByRole('option', { name: 'lamb@iiitkottayam.ac.in' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Changed by'), { target: { value: 'u1' } });
    await waitFor(() => expect(screen.queryByText(/role: default → captain/)).toBeNull());
    expect(screen.getByText(/name: Inter → Inter League/)).toBeTruthy();
  });

  it('says when nothing is recorded for the filter', async () => {
    db.rows = [];
    render(<AuditHistory />);
    expect(await screen.findByText(/no changes recorded yet/i)).toBeTruthy();
  });

  it('reports a failure to load', async () => {
    db.fail = { message: 'permission denied for table audit_log' };
    render(<AuditHistory />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/permission denied/);
  });

  it('offers older changes when a full page was returned', async () => {
    db.rows = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => entry({ id: 1000 - i, changes: { name: { from: `n${i}`, to: `m${i}` } } }));
    render(<AuditHistory />);
    await screen.findByRole('list', { name: 'Audit entries' });
    fireEvent.click(screen.getByRole('button', { name: /show older changes/i }));
    await waitFor(() => expect(screen.getByText(`name: n${PAGE_SIZE + 4} → m${PAGE_SIZE + 4}`)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /show older changes/i })).toBeNull();
  });
});
