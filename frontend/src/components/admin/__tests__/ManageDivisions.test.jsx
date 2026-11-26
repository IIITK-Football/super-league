// @vitest-environment jsdom
// Group: frontend-components. Read fixtures and a Worker mutation mock keep the UI contract explicit.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = { tables: {}, calls: [], fail: {}, delay: null };

function seed() {
  db.tables = {
    divisions: [],
    seasons: [],
    section_types: [
      { key: 'fixtures', label: 'Fixtures', description: 'Schedule', default_enabled: true, default_sort_order: 20 },
      { key: 'fantasy', label: 'Fantasy', description: 'Predictions', default_enabled: true, default_sort_order: 80 },
      { key: 'bracket', label: 'Bracket', description: 'Knockout', default_enabled: false, default_sort_order: 40 },
    ],
    season_sections: [],
  };
  db.calls = [];
  db.fail = {};
  db.delay = null;
}

let nextId = 1;
function from(table) {
  const q = { op: 'select', payload: null, filters: [], single: false, opts: {} };
  const matches = (row) => q.filters.every(([c, v]) => row[c] === v);
  const run = () => {
    db.calls.push({ table, op: q.op, payload: q.payload, filters: q.filters, opts: q.opts });
    const failure = db.fail[`${table}.${q.op}`];
    if (failure) return { data: null, error: failure };
    const rows = db.tables[table];
    if (q.op === 'select') return { data: rows.filter(matches).map((r) => ({ ...r })), error: null };
    if (q.op === 'insert') {
      const added = (Array.isArray(q.payload) ? q.payload : [q.payload]).map((r) => ({ id: `id-${nextId++}`, archived_at: null, is_current: false, ...r }));
      rows.push(...added);
      return { data: q.single ? added[0] : added, error: null };
    }
    if (q.op === 'update') {
      const changed = rows.filter(matches);
      changed.forEach((r) => Object.assign(r, q.payload));
      return { data: changed.map((r) => ({ id: r.id })), error: null };
    }
    if (q.op === 'delete') {
      const gone = rows.filter(matches);
      db.tables[table] = rows.filter((r) => !matches(r));
      return { data: gone.map((r) => ({ id: r.id })), error: null };
    }
    if (q.op === 'upsert') {
      const i = rows.findIndex((r) => r.season_id === q.payload.season_id && r.section_key === q.payload.section_key);
      if (i >= 0) rows[i] = { ...rows[i], ...q.payload }; else rows.push({ ...q.payload });
      return { data: null, error: null };
    }
    return { data: null, error: null };
  };
  const b = {
    select: () => b,
    insert: (p, o) => Object.assign(q, { op: 'insert', payload: p, opts: o ?? {} }) && b,
    update: (p) => Object.assign(q, { op: 'update', payload: p }) && b,
    delete: () => Object.assign(q, { op: 'delete' }) && b,
    upsert: (p, o) => Object.assign(q, { op: 'upsert', payload: p, opts: o ?? {} }) && b,
    eq: (c, v) => { q.filters.push([c, v]); return b; },
    order: () => b,
    single: () => { q.single = true; return b; },
    then: (resolve, reject) => (db.delay ?? Promise.resolve()).then(run).then(resolve, reject),
  };
  return b;
}

const worker = vi.fn(async (path, { method, body }) => {
  const payload = body ? JSON.parse(body) : undefined;
  const [, , table, id, action] = path.split('/');
  if (method === 'POST' && !id) {
    const row = { id: `id-${nextId++}`, visibility: 'hidden', archived_at: null, is_current: false, ...payload };
    db.tables[table].push(row);
    if (table === 'seasons') db.tables.season_sections.push(...db.tables.section_types.map((t) => ({
      season_id: row.id, section_key: t.key, enabled: t.default_enabled, nav_visible: t.default_enabled, sort_order: t.default_sort_order,
    })));
  } else if (action === 'current') {
    if (db.fail.current) throw db.fail.current;
    const season = db.tables.seasons.find((row) => row.id === id);
    db.tables.seasons.filter((row) => row.division_id === season.division_id).forEach((row) => { row.is_current = row.id === id; });
  } else if (action === 'sections') {
    db.tables.season_sections = db.tables.season_sections.filter((row) => row.season_id !== id);
    db.tables.season_sections.push(...payload.sections.map((row, index) => ({ ...row, season_id: id, sort_order: index })));
  } else if (method === 'PATCH') {
    const row = db.tables[table].find((row) => row.id === id);
    Object.assign(row, payload);
    if ('archived' in payload) {
      row.archived_at = payload.archived ? new Date().toISOString() : null;
      row.visibility = 'hidden';
    }
  } else if (method === 'DELETE') {
    if (db.fail.delete) throw db.fail.delete;
    db.tables[table] = db.tables[table].filter((row) => row.id !== id);
  }
  return { success: true };
});

vi.mock('../../../lib/supabase', () => ({ supabase: { from: (t) => from(t) } }));
vi.mock('../../../hooks/useApi', () => ({ fetchApi: (...args) => worker(...args) }));

import ManageDivisions, { describeError, parseSettings, validateDivision, validateSeason } from '../ManageDivisions';

const type = (label, value, scope = screen) => fireEvent.change(scope.getByLabelText(label), { target: { value } });
const writes = (table, op) => db.calls.filter((c) => c.table === table && c.op === op);

async function addDivision(name = 'Inter', slug = 'inter') {
  const form = screen.getByRole('form', { name: 'New division' });
  type(/division name/i, name, within(form));
  type(/^slug/i, slug, within(form));
  fireEvent.click(within(form).getByRole('button', { name: /add division/i }));
  await screen.findByRole('status');
}

beforeEach(() => {
  seed();
  worker.mockClear();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ManageDivisions states', () => {
  it('shows a loading state, then the empty state', async () => {
    let release;
    db.delay = new Promise((r) => { release = r; });
    render(<ManageDivisions />);
    expect(screen.getByText(/loading divisions/i)).toBeTruthy();
    release();
    expect(await screen.findByText(/no divisions yet/i)).toBeTruthy();
  });

  it('shows a load error', async () => {
    db.fail['divisions.select'] = { code: 'XX000', message: 'database unavailable' };
    render(<ManageDivisions />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/database unavailable/);
  });
});

describe('divisions', () => {
  it('validates before writing anything', async () => {
    render(<ManageDivisions />);
    await screen.findByText(/no divisions yet/i);
    await waitFor(() => expect(db.calls.length).toBe(1));
    const form = screen.getByRole('form', { name: 'New division' });
    type(/division name/i, 'Inter', within(form));
    type(/^slug/i, 'Inter Division', within(form));
    fireEvent.click(within(form).getByRole('button', { name: /add division/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/lowercase letters/);
    expect(worker).not.toHaveBeenCalled();
  });

  it('creates a division and lists it', async () => {
    render(<ManageDivisions />);
    await screen.findByText(/no divisions yet/i);
    await addDivision();
    expect(screen.getByRole('status').textContent).toMatch(/Division "Inter" created/);
    expect(worker).toHaveBeenCalledWith('/admin/divisions', {
      method: 'POST', body: JSON.stringify({ slug: 'inter', name: 'Inter', short_name: null, primary_color: null }),
    });
    expect(writes('divisions', 'insert')).toHaveLength(0);
    expect(await screen.findByText('Hidden')).toBeTruthy();
    const list = await screen.findByRole('list', { name: 'Divisions' });
    expect(within(list).getByDisplayValue('Inter')).toBeTruthy();
  });

  it('reports a refused write in words a dictator understands', async () => {
    worker.mockRejectedValueOnce({ status: 403 });
    render(<ManageDivisions />);
    await screen.findByText(/no divisions yet/i);
    const form = screen.getByRole('form', { name: 'New division' });
    type(/division name/i, 'Inter', within(form));
    type(/^slug/i, 'inter', within(form));
    fireEvent.click(within(form).getByRole('button', { name: /add division/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/only a dictator/i);
  });

  it('archives and restores a division instead of deleting it', async () => {
    render(<ManageDivisions />);
    await screen.findByText(/no divisions yet/i);
    await addDivision();
    fireEvent.click(await screen.findByRole('button', { name: /archive/i }));
    await screen.findByText(/archived\./i);
    expect(db.tables.divisions[0].archived_at).toBeTruthy();
    expect(await screen.findByText('Archived')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /restore/i }));
    await screen.findByText(/restored/i);
    expect(db.tables.divisions[0].archived_at).toBeNull();
  });

  it('explains why a division with data cannot be deleted', async () => {
    render(<ManageDivisions />);
    await screen.findByText(/no divisions yet/i);
    await addDivision();
    db.fail.delete = { status: 409, message: 'This division has seasons. Archive it instead.' };
    fireEvent.click(screen.getByRole('button', { name: /delete inter/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/archive it instead/i);
  });
});

describe('seasons and sections', () => {
  async function openInter() {
    render(<ManageDivisions />);
    await screen.findByText(/no divisions yet/i);
    await addDivision();
    fireEvent.click(await screen.findByRole('button', { name: /^seasons$/i }));
    return screen.findByRole('form', { name: 'New season' });
  }

  it('shows the empty seasons state, then creates a season with its default sections', async () => {
    const form = await openInter();
    expect(await screen.findByText(/no seasons yet/i)).toBeTruthy();
    type(/season name/i, '2026', within(form));
    type(/season slug/i, '2026', within(form));
    fireEvent.click(within(form).getByRole('button', { name: /add season/i }));
    expect((await screen.findByRole('status')).textContent).toMatch(/created with the default sections/);
    expect(worker.mock.calls.at(-1)[0]).toBe('/admin/seasons');
    expect(db.tables.season_sections).toHaveLength(3);
    expect(writes('season_sections', 'insert')).toHaveLength(0);
  });

  it('rejects an end date before the start date', async () => {
    const form = await openInter();
    type(/season name/i, '2026', within(form));
    type(/season slug/i, '2026', within(form));
    type(/starts/i, '2026-09-01', within(form));
    type(/ends/i, '2026-08-01', within(form));
    fireEvent.click(within(form).getByRole('button', { name: /add season/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/end date/);
    expect(worker.mock.calls.map(([path]) => path)).toEqual(['/admin/divisions']);
  });

  it('makes a season current through the one-step function', async () => {
    const form = await openInter();
    type(/season name/i, '2026', within(form));
    type(/season slug/i, '2026', within(form));
    fireEvent.click(within(form).getByRole('button', { name: /add season/i }));
    const seasonList = await screen.findByRole('list', { name: 'Seasons' });
    fireEvent.click(within(seasonList).getByRole('button', { name: 'Publish' }));
    fireEvent.click(await screen.findByRole('button', { name: /make current/i }));
    await screen.findByText(/is now the current season of Inter/);
    expect(worker).toHaveBeenCalledWith(`/admin/seasons/${db.tables.seasons[0].id}/current`, { method: 'POST' });
    expect(await screen.findByText('Current')).toBeTruthy();
  });

  it('shows a refused current-season change', async () => {
    const form = await openInter();
    type(/season name/i, '2026', within(form));
    type(/season slug/i, '2026', within(form));
    fireEvent.click(within(form).getByRole('button', { name: /add season/i }));
    db.fail.current = { status: 403 };
    const seasonList = await screen.findByRole('list', { name: 'Seasons' });
    fireEvent.click(within(seasonList).getByRole('button', { name: 'Publish' }));
    fireEvent.click(await screen.findByRole('button', { name: /make current/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/only a dictator/i);
  });

  it('toggles a section and saves its settings; invalid settings are not sent', async () => {
    const form = await openInter();
    type(/season name/i, '2026', within(form));
    type(/season slug/i, '2026', within(form));
    fireEvent.click(within(form).getByRole('button', { name: /add season/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^sections$/i }));
    const sections = await screen.findByRole('list', { name: 'Sections' });
    fireEvent.click(within(sections).getByLabelText('Fantasy enabled'));
    type('Fantasy settings', '[1, 2]', within(sections));
    fireEvent.click(screen.getByRole('button', { name: 'Save sections' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/JSON object/);
    expect(writes('season_sections', 'upsert')).toHaveLength(0);

    type('Fantasy settings', '{"note": "off this season"}', within(sections));
    fireEvent.click(screen.getByRole('button', { name: 'Save sections' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/Sections saved/);
    const [path, init] = worker.mock.calls.at(-1);
    expect(path).toMatch(/seasons\/.+\/sections/);
    expect(JSON.parse(init.body).sections.find((row) => row.section_key === 'fantasy')).toMatchObject({
      enabled: false, settings: { note: 'off this season' },
    });
  });
});

describe('helpers', () => {
  it('validate like the database constraints', () => {
    expect(validateDivision({ name: 'Inter', slug: 'inter', primary_color: '' })).toBe('');
    expect(validateDivision({ name: 'Inter', slug: 'inter', primary_color: 'red' })).toMatch(/colour/);
    expect(validateSeason({ name: '2026–27', slug: '2026-27', starts_on: '', ends_on: '' })).toBe('');
    expect(parseSettings('').value).toEqual({});
    expect(parseSettings('{"a":1}').value).toEqual({ a: 1 });
    expect(parseSettings('nope').error).toMatch(/not valid JSON/);
    expect(describeError({ code: '23505' })).toMatch(/already used/);
  });
});
