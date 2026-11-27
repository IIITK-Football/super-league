// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Rules } from '../Rules';

const state = vi.hoisted(() => ({ api: null }));
vi.mock('../../context/LeagueContext', () => ({
  useLeague: () => ({ seasonScope: { ready: true, divisionRecord: { name: 'Inter' }, season: { name: 'Winter' } } }),
}));
vi.mock('../../hooks/useApi', () => ({ useApi: () => state.api }));
vi.mock('../../components/Loader', () => ({ Loader: () => <p>Loading</p> }));
afterEach(cleanup);

const answer = (rules) => ({ loading: false, refetch: vi.fn(), data: { success: true, data: { rules } } });

it('presents every block type of the published version, leaving hidden blocks out', () => {
  state.api = answer({
    version: 1, published_at: '2026-11-27T10:00:00Z',
    blocks: [
      { id: '1', type: 'section', hidden: false, title: 'Points', items: ['Win: 3 Points'] },
      { id: '2', type: 'callout', hidden: false, tone: 'eligibility', title: 'Who may play', body: 'Students' },
      { id: '3', type: 'steps', hidden: false, items: ['Register'] },
      { id: '4', type: 'table', hidden: false, columns: ['Card'], rows: [['Red']] },
      { id: '5', type: 'notice', hidden: false, tone: 'warning', body: '<b>no markup</b>' },
      { id: '6', type: 'notice', hidden: true, tone: 'info', body: 'Secret' },
    ],
  });
  render(<Rules />);
  expect(screen.getByRole('heading', { name: 'Inter Rules' })).toBeTruthy();
  for (const text of ['Win:', 'Who may play', 'Register', 'Red', '<b>no markup</b>']) expect(screen.getByText(text)).toBeTruthy();
  expect(screen.getByRole('table')).toBeTruthy();
  expect(screen.queryByText('Secret')).toBeNull();
});

it('says when nothing is published', () => {
  state.api = answer(null);
  render(<Rules />);
  expect(screen.getByText('Rules have not been published for this season yet.')).toBeTruthy();
});

it('shows loading and failure states', () => {
  state.api = { loading: true, data: null };
  const view = render(<Rules />);
  expect(screen.getByText('Loading')).toBeTruthy();
  state.api = { loading: false, data: null, refetch: vi.fn() };
  view.rerender(<Rules />);
  expect(screen.getByRole('alert').textContent).toContain('The rules could not be loaded.');
});
