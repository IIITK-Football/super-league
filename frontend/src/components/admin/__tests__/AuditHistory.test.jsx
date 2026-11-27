// @vitest-environment jsdom
// Group: frontend-components. The dictator's audit history view against an in-memory Data API fake: loading, empty,
// success and error states, the table and actor filters, readable summaries (only changed fields for an update, a
// private field never shown) and paging. The real path is AuditHistory.local.test.jsx (audit group).
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { optionsOf, pick, trigger } from './listbox';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = { rows: [], profiles: [], actors: [], actorsFail: null, calls: [], fail: null, slow: null };

function from(table) {
  const q = { filters: [], range: null, ins: null };
  const b = {
    select: () => b,
    order: () => b,
    eq: (c, v) => { q.filters.push([c, v]); return b; },
    in: (c, v) => { q.ins = [c, v]; return b; },
    range: (a, z) => { q.range = [a, z]; return b; },
    then: (resolve, reject) => (db.slow && q.filters.some(([, v]) => v === db.slow)
      ? new Promise((r) => setTimeout(r, 50)) : Promise.resolve()).then(() => {
      db.calls.push({ table, filters: q.filters, range: q.range });
      if (table === 'user_profiles') return { data: db.profiles.filter((p) => q.ins[1].includes(p.id)), error: null };
      if (db.fail) return { data: null, error: db.fail };
      const rows = db.rows.filter((r) => q.filters.every(([c, v]) => r[c] === v));
      return { data: q.range ? rows.slice(q.range[0], q.range[1] + 1) : rows, error: null };
    }).then(resolve, reject),
  };
  return b;
}
const rpc = async (name) => {
  db.calls.push({ rpc: name });
  if (db.actorsFail) return { data: null, error: db.actorsFail };
  return { data: db.actors, error: null };
};
vi.mock('../../../lib/supabase', () => ({ supabase: { from: (t) => from(t), rpc: (...a) => rpc(...a) } }));

import AuditHistory, { PAGE_SIZE, UNKNOWN_ACCOUNT, describeActor, summarize } from '../AuditHistory';

const entry = (over) => ({ id: 1, occurred_at: '2026-11-18T10:00:00Z', actor_id: 'u1', actor_role: 'authenticated', action: 'update', table_name: 'divisions', record_id: 'd1', changes: {}, ...over });

beforeEach(() => {
  db.rows = [
    entry({ id: 3, changes: { name: { from: 'Inter', to: 'Inter League' } } }),
    entry({ id: 2, actor_id: 'u2', table_name: 'user_roles', record_id: 'u9', changes: { role: { from: 'default', to: 'captain' } } }),
    entry({ id: 1, actor_id: null, actor_role: 'postgres', action: 'insert', table_name: 'seasons', record_id: 's1', changes: { name: '2026', slug: '2026', archived_at: null } }),
  ];
  db.profiles = [{ id: 'u1', email: 'lamb@iiitkottayam.ac.in' }, { id: 'u2', email: 'diana@iiitkottayam.ac.in' }];
  // What audit_actors returns: every person in the whole history, labelled by the database.
  db.actors = [{ actor_id: 'u2', label: 'diana@iiitkottayam.ac.in', available: true }, { actor_id: 'u1', label: 'lamb@iiitkottayam.ac.in', available: true }];
  db.actorsFail = null;
  db.calls = [];
  db.fail = null;
  db.slow = null;
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
    expect(describeActor(entry({ actor_id: '6a1f0c2e-0000-4000-8000-000000000001' }), {})).toBe(UNKNOWN_ACCOUNT); // never a raw id
    expect(describeActor(entry({ actor_id: null, actor_role: 'service_role' }), {})).toBe('Server');
    expect(describeActor(entry({ actor_id: null, actor_role: 'postgres' }), {})).toBe('System (postgres)');
    expect(describeActor(entry({ actor_id: null, actor_role: 'auto-link' }), {})).toBe('Automatic link (email verified)');
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
    expect(db.calls.find((c) => c.table === 'audit_log')).toMatchObject({ table: 'audit_log', range: [0, PAGE_SIZE - 1] });
  });

  it('offers every person in the whole history, including one who appears only on an older page', async () => {
    db.actors = [...db.actors, { actor_id: 'u-old', label: 'Old Timer', available: true }];
    db.rows = [...db.rows, ...Array.from({ length: PAGE_SIZE }, (_, i) => entry({ id: 100 + i, actor_id: i === PAGE_SIZE - 1 ? 'u-old' : 'u1' }))];
    render(<AuditHistory />);
    await screen.findByRole('list', { name: 'Audit entries' });
    await waitFor(() => expect(trigger('Changed by').disabled).toBe(false));
    expect(await optionsOf('Changed by')).toEqual(['Anyone', 'diana@iiitkottayam.ac.in', 'lamb@iiitkottayam.ac.in', 'Old Timer']);
    await pick('Changed by', 'Old Timer');
    await waitFor(() => expect(db.calls.filter((c) => c.table === 'audit_log').at(-1).filters).toEqual([['actor_id', 'u-old']]));
  });

  it('shows the database labels for people without a name and for deleted accounts, never a raw id', async () => {
    const gone = '9d3c1b7a-0000-4000-8000-0000000000ff';
    db.rows = [entry({ id: 9, actor_id: gone }), entry({ id: 8, actor_id: 'u3' })];
    db.actors = [{ actor_id: 'u3', label: 'plain@iiitkottayam.ac.in', available: true }, { actor_id: gone, label: 'Deleted or unavailable account', available: false }];
    render(<AuditHistory />);
    const list = await screen.findByRole('list', { name: 'Audit entries' });
    await waitFor(() => expect(within(list).getByText('Deleted or unavailable account')).toBeTruthy());
    expect(within(list).getByText('plain@iiitkottayam.ac.in')).toBeTruthy();
    expect(document.body.textContent).not.toContain(gone);
  });

  it('reloads the people list once when someone new appears, and never loops for an unknown account', async () => {
    render(<AuditHistory />);
    await screen.findByRole('list', { name: 'Audit entries' });
    await waitFor(() => expect(trigger('Changed by').disabled).toBe(false));
    const rpcCalls = () => db.calls.filter((c) => c.rpc).length;
    expect(rpcCalls()).toBe(1);
    // Two new people act after the page loaded: the list now knows one of them (u9) but not the other (u8).
    db.rows = [entry({ id: 21, actor_id: 'u9' }), entry({ id: 20, actor_id: 'u8' }), ...db.rows];
    db.actors = [...db.actors, { actor_id: 'u9', label: 'New Person (new@iiitkottayam.ac.in)', available: true }];
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    const list = screen.getByRole('list', { name: 'Audit entries' });
    await waitFor(() => expect(within(list).getByText('New Person (new@iiitkottayam.ac.in)')).toBeTruthy());
    expect(within(list).getByText(UNKNOWN_ACCOUNT)).toBeTruthy();
    expect(rpcCalls()).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => expect(db.calls.filter((c) => c.table === 'audit_log').length).toBeGreaterThanOrEqual(3));
    await new Promise((r) => setTimeout(r, 30));
    expect(rpcCalls()).toBe(2); // asked once per person, not on every refresh
  });

  it('keeps the history usable when the people list cannot be loaded, and can retry', async () => {
    db.actorsFail = { message: 'permission denied' };
    render(<AuditHistory />);
    const list = await screen.findByRole('list', { name: 'Audit entries' });
    await waitFor(() => expect(screen.getByText(/people list could not be loaded/i)).toBeTruthy());
    expect(trigger('Changed by').disabled).toBe(true);
    expect(within(list).getAllByText(UNKNOWN_ACCOUNT).length).toBeGreaterThan(0);
    db.actorsFail = null;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(trigger('Changed by').disabled).toBe(false));
    expect(within(list).getAllByText('lamb@iiitkottayam.ac.in').length).toBeGreaterThan(0);
  });

  it('shows the entries of the filter chosen last, even when an earlier filter answers later', async () => {
    render(<AuditHistory />);
    await screen.findByRole('list', { name: 'Audit entries' });
    db.slow = 'seasons';
    await pick('Table', 'Seasons');
    await pick('Table', 'Roles');
    await new Promise((r) => setTimeout(r, 120));
    const items = within(screen.getByRole('list', { name: 'Audit entries' })).getAllByRole('listitem');
    expect(items.map((li) => li.textContent).join(' ')).toMatch(/role: default → captain/);
    expect(items.map((li) => li.textContent).join(' ')).not.toMatch(/Seasons/);
  });

  it('filters by table and by the person who made the change', async () => {
    render(<AuditHistory />);
    await screen.findByRole('list', { name: 'Audit entries' });
    await pick('Table', 'Roles');
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Audit entries' })).getAllByText(/role: default → captain/)).toHaveLength(1));
    expect(db.calls.at(-1)?.table === 'audit_log' ? db.calls.at(-1).filters : db.calls.at(-2).filters).toEqual([['table_name', 'user_roles']]);
    await pick('Table', 'All tables');
    await waitFor(() => expect(trigger('Changed by').disabled).toBe(false));
    await pick('Changed by', 'lamb@iiitkottayam.ac.in');
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
