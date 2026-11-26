// @vitest-environment jsdom
// Group: frontend-components. A knockout season with no stage data lists its matches as "Knockout matches",
// oldest first, with no invented round names or clubs.
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: (table) => {
      const b = {
        select: () => b,
        eq: () => b,
        order: () => b,
        maybeSingle: async () => ({ data: table === 'divisions' ? { id: 'd1', slug: 'wsl', name: 'WSL' } : null, error: null }),
        then: (resolve) => resolve(table === 'seasons'
          ? { data: [{ id: 's1', slug: '2026', name: '2026', is_current: true, starts_on: '2026-08-01', format: 'knockout' }], error: null }
          : { data: [], error: null }),
      };
      return b;
    },
  },
}));

const team = (name) => ({ name, logo_url: null });
const match = (id, date) => ({ id, status: 'completed', date, home_score: 1, away_score: 0, home: team('Home ' + id), away: team('Away ' + id) });

const fetchMock = vi.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    success: true,
    data: {
      standings: [],
      // Newest first, as the schedule arrives from the API.
      bracketMatches: [match('late', '2026-11-20T10:00:00Z'), match('early', '2026-11-10T10:00:00Z')],
    },
  }),
}));

import { LeagueProvider } from '../../context/LeagueContext';
import { Standings } from '../Standings';

beforeEach(() => {
  window.sessionStorage.clear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('knockout season without stage data', () => {
  it('lists the season matches as knockout matches, oldest first', async () => {
    render(
      <LeagueProvider>
        <MemoryRouter initialEntries={['/standings/wsl']}>
          <Routes><Route path="/standings/:division" element={<Standings />} /></Routes>
        </MemoryRouter>
      </LeagueProvider>,
    );
    const section = await screen.findByRole('region', { name: 'Knockout matches' });
    const names = within(section).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(names).toEqual(['/matches/early', '/matches/late']);
    expect(screen.queryByText(/Quarter|Semi|Eliminator|Final/)).toBeNull();
  });
});
