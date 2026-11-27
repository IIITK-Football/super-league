// @vitest-environment jsdom
// Group: frontend-components. The division home opens on the live match, shows a retry when the table fails, hides
// modules with no data, and never reloads the document.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: (table) => {
      const b = {
        select: () => b,
        eq: () => b,
        is: () => b,
        order: () => b,
        maybeSingle: async () => ({ data: table === 'divisions' ? { id: 'd1', slug: 'super-league', name: 'Super League' } : null, error: null }),
        then: (resolve) => resolve(table === 'seasons'
          ? { data: [{ id: 's26', slug: '2026', name: '2026', is_current: true, starts_on: '2026-08-01' }], error: null }
          : { data: table === 'section_types' ? [{ key: 'overview', label: 'Overview', default_enabled: true, default_sort_order: 1 }] : [], error: null }),
      };
      return b;
    },
  },
}));

import { LeagueProvider } from '../../context/LeagueContext';
import { DivisionHomeRoute } from '../DivisionHomeRoute';
import { Home } from '../Home';

const team = (id, name) => ({ id, name });
const standingsPayload = (over = {}) => ({
  success: true,
  data: {
    standings: [
      { teamId: 't1', teamName: 'AL Balal', rank: 1, form: ['W'], logoUrl: null, stats: { matchesPlayed: 1, won: 1, drawn: 0, lost: 0, goalsFor: 2, goalsAgainst: 0, goalDifference: 2, points: 3 } },
    ],
    bracketMatches: [
      { id: 'm-live', status: 'live', date: '2026-11-26T10:00:00Z', home_score: 1, away_score: 0, home_team_id: 't1', away_team_id: 't2', home: team('t1', 'AL Balal'), away: team('t2', 'KFC') },
      { id: 'm-old', status: 'completed', date: '2026-11-01T10:00:00Z', home_score: 2, away_score: 0, home_team_id: 't1', away_team_id: 't2', home: team('t1', 'AL Balal'), away: team('t2', 'KFC') },
    ],
    ...over,
  },
});
const dashboardPayload = { success: true, data: { news: [], topScorer: null, topAssist: null, fantasyTop: [] } };

const responses = { standings: null, dashboard: null };
const fetchMock = vi.fn(async (url) => {
  const body = String(url).includes('/home/dashboard') ? responses.dashboard : responses.standings;
  return { ok: body.ok !== false, status: body.status ?? 200, json: async () => body.json };
});

function renderHome() {
  return render(
    <LeagueProvider>
      <MemoryRouter initialEntries={['/super-league']}>
        <Routes>
          <Route path="/:division" element={<DivisionHomeRoute><Home /></DivisionHomeRoute>} />
        </Routes>
      </MemoryRouter>
    </LeagueProvider>,
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  responses.standings = { json: standingsPayload() };
  responses.dashboard = { json: dashboardPayload };
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('division home', () => {
  it('opens on the live match and shows the table', async () => {
    renderHome();
    expect(await screen.findByRole('region', { name: 'Live now' })).toBeTruthy();
    expect(screen.getAllByText('AL Balal').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Table' })).toBeTruthy();
  });

  it('never reloads the document', async () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, reload } });
    try {
      renderHome();
      await screen.findByRole('heading', { name: 'Table' });
      expect(reload).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('offers a retry when the table fails to load, and retries on click', async () => {
    responses.standings = { ok: false, status: 500, json: { success: false, message: 'boom' } };
    renderHome();
    const retry = await screen.findByRole('button', { name: 'Try again' });
    const before = fetchMock.mock.calls.length;
    responses.standings = { json: standingsPayload() };
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
    expect(await screen.findByRole('heading', { name: 'Table' })).toBeTruthy();
  });

  it('hides the news, stats and predictions modules when they have no data', async () => {
    renderHome();
    await screen.findByRole('heading', { name: 'Table' });
    expect(screen.queryByRole('heading', { name: 'News' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Player stats' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Predictions' })).toBeNull();
  });

  it('links the top scorer to the player', async () => {
    responses.dashboard = {
      json: { success: true, data: { ...dashboardPayload.data, topScorer: { playerId: 'p9', name: 'Ada Lovelace', club: 'KFC', stat: 4 } } },
    };
    renderHome();
    const link = await screen.findByRole('link', { name: 'Ada Lovelace' });
    expect(link.getAttribute('href')).toBe('/teams?player=p9');
  });

  it('offers controls to move and pause the news carousel', async () => {
    const intervals = vi.spyOn(window, 'setInterval');
    responses.dashboard = { json: { success: true, data: { ...dashboardPayload.data,
      news: [{ id: 'one', title: 'First article' }, { id: 'two', title: 'Second article' }] } } };
    renderHome();
    const carousel = await screen.findByRole('region', { name: 'News carousel' });
    expect(intervals).toHaveBeenCalledWith(expect.any(Function), 12000);
    const rail = carousel.querySelector('ul');
    rail.scrollTo = vi.fn();
    fireEvent.click(screen.getByRole('button', { name: 'Next news' }));
    expect(rail.scrollTo).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Pause news carousel' }));
    expect(screen.getByRole('button', { name: 'Play news carousel' })).toBeTruthy();
    intervals.mockRestore();
  });
});
