// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ManageRules from '../ManageRules';

const api = vi.hoisted(() => ({ state: null, calls: [] }));
vi.mock('../../../hooks/useApi', () => ({
  fetchApi: async (path, options = {}) => {
    api.calls.push([options.method || 'GET', path, options.body ? JSON.parse(options.body) : undefined]);
    const { state } = api;
    if (state.fail) throw new Error(state.fail);
    if (options.method === 'PUT') { state.draft = { blocks: JSON.parse(options.body).blocks }; return { data: null }; }
    if (options.method === 'POST') {
      const version = state.versions.length + 1;
      state.versions.unshift({ id: `v${version}`, version, published_at: '2026-11-27T10:00:00Z', blocks: state.draft.blocks.filter((b) => !b.hidden) });
      return { data: { version } };
    }
    const found = path.match(/versions\/(\d+)$/);
    if (found) return { data: state.versions.find((v) => v.version === Number(found[1])) };
    return { data: { draft: state.draft, versions: state.versions } };
  },
}));

const notice = (id, body) => ({ id, type: 'notice', hidden: false, tone: 'info', body });
const season = { id: 's1', name: 'Winter' };

beforeEach(() => {
  api.calls = [];
  api.state = { draft: null, versions: [] };
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('adds, reorders and hides blocks, previews without publishing, then saves and publishes', async () => {
  api.state.draft = { blocks: [notice('a', 'Alpha'), notice('b', 'Beta')] };
  render(<ManageRules season={season} />);
  expect(await screen.findByText('Draft saved, not published')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Move block 2 up' }));
  fireEvent.click(screen.getByRole('button', { name: 'Hide block 2' }));
  fireEvent.change(screen.getByLabelText('New block type'), { target: { value: 'steps' } });
  fireEvent.click(screen.getByRole('button', { name: /Add block/ }));
  fireEvent.change(screen.getByLabelText('Steps (one per line)'), { target: { value: 'Arrive\n\nWarm up' } });
  expect(screen.getByText('Unsaved changes')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Publish/ }).disabled).toBe(true);

  fireEvent.click(screen.getByRole('button', { name: /Preview/ }));
  const preview = screen.getByRole('region', { name: 'Preview' });
  expect(within(preview).getByText('Preview — not published')).toBeTruthy();
  expect(within(preview).getByText('Warm up')).toBeTruthy();
  expect(within(preview).queryByText('Alpha')).toBeNull();
  expect(api.calls.every(([method]) => method === 'GET')).toBe(true);

  fireEvent.click(screen.getByRole('button', { name: /Save draft/ }));
  await screen.findByText(/Draft saved\. Visitors/);
  const [, , body] = api.calls.find(([method]) => method === 'PUT');
  expect(body.blocks.map((b) => [b.type, b.hidden])).toEqual([['notice', false], ['notice', true], ['steps', false]]);
  expect(body.blocks[2]).toMatchObject({ items: ['Arrive', 'Warm up'] });
  expect(body.blocks[2]).not.toHaveProperty('title');

  fireEvent.click(screen.getByRole('button', { name: /Publish/ }));
  expect(await screen.findByText('Matches version 1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'View version 1' }));
  const version = await screen.findByRole('region', { name: 'Version 1' });
  expect(within(version).getByText('Beta')).toBeTruthy();
  expect(within(version).queryByText('Alpha')).toBeNull();
});

it('names the unfinished block instead of saving it', async () => {
  render(<ManageRules season={season} />);
  expect(await screen.findByText('No rules yet')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('New block type'), { target: { value: 'callout' } });
  fireEvent.click(screen.getByRole('button', { name: /Add block/ }));
  fireEvent.click(screen.getByRole('button', { name: /Save draft/ }));
  expect(screen.getByRole('alert').textContent).toBe('Block 1 (Eligibility callout) needs a title.');
  expect(api.calls.some(([method]) => method === 'PUT')).toBe(false);
});

it('edits a table cell by cell', async () => {
  render(<ManageRules season={season} />);
  await screen.findByText('No rules yet');
  fireEvent.change(screen.getByLabelText('New block type'), { target: { value: 'table' } });
  fireEvent.click(screen.getByRole('button', { name: /Add block/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Column' }));
  fireEvent.change(screen.getByLabelText('Row 1, column 3'), { target: { value: '3 points' } });
  fireEvent.click(screen.getByRole('button', { name: /Save draft/ }));
  await waitFor(() => expect(api.calls.some(([method]) => method === 'PUT')).toBe(true));
  const [, , body] = api.calls.find(([method]) => method === 'PUT');
  expect(body.blocks[0].rows).toEqual([['', '', '3 points']]);
});

it('shows a load failure with a retry', async () => {
  api.state.fail = 'Only a dictator can manage rules.';
  render(<ManageRules season={season} />);
  expect(await screen.findByText('Only a dictator can manage rules.')).toBeTruthy();
  api.state.fail = null;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('No rules yet')).toBeTruthy();
});
