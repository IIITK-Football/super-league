// @vitest-environment jsdom
// Group: frontend-components. Every season-dependent request carries the selected division and season: the
// statistics page, the fantasy schedule, players and leaderboard all follow the season chosen for the division
// (here WSL 2027, remembered for the division after it was chosen on the homepage or typed as /wsl/2027).
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: (table) => {
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: table === 'divisions' ? { id: 'd-wsl', slug: 'wsl', name: 'WSL' } : null, error: null }),
        then: (resolve) => resolve(table === 'seasons'
          ? { data: [
              { id: 's-2026', slug: '2026', name: '2026', is_current: true, starts_on: '2026-08-01' },
              { id: 's-2027', slug: '2027', name: '2027', is_current: false, starts_on: '2027-08-01' },
            ], error: null }
          : { data: [], error: null }),
      };
      return b;
    },
  },
}));
vi.mock('../../components/Loader', () => ({ Loader: ({ text }) => <p>{text || 'Loading'}</p> }));

const fetchMock = vi.fn(async () => ({ json: async () => ({ success: true, data: { topScorers: [], topAssists: [], overall: [] } }) }));

import { LeagueProvider } from '../../context/LeagueContext';
import { useApi } from '../../hooks/useApi';
import { Leaderboard } from '../Leaderboard';

function Probe({ endpoint }) {
  useApi(endpoint);
  return null;
}

const queries = () => fetchMock.mock.calls.map(([url]) => new URL(String(url), 'http://x'));

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  window.sessionStorage.clear();
  window.sessionStorage.setItem('league:division', 'wsl');
  window.sessionStorage.setItem('league:season:wsl', '2027');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('season-scoped pages', () => {
  it('the statistics page asks for the chosen season and names it', async () => {
    render(<LeagueProvider><Leaderboard /></LeagueProvider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = queries().find((u) => u.pathname.endsWith('/leaderboard'));
    expect(url.searchParams.get('division')).toBe('wsl');
    expect(url.searchParams.get('season')).toBe('2027');
    expect(await screen.findByText(/WSL 2027 Player Stats/i)).toBeTruthy();
  });

  it('fantasy schedule, players and leaderboard requests carry the chosen season', async () => {
    render(
      <LeagueProvider>
        <Probe endpoint="/schedule" />
        <Probe endpoint="/players" />
        <Probe endpoint="/predictions/leaderboard" />
      </LeagueProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    for (const url of queries()) {
      expect(url.searchParams.get('division')).toBe('wsl');
      expect(url.searchParams.get('season')).toBe('2027');
    }
  });

  it('without a choice, requests use the division\'s current season', async () => {
    window.sessionStorage.removeItem('league:season:wsl');
    render(<LeagueProvider><Probe endpoint="/schedule" /></LeagueProvider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(queries()[0].searchParams.get('season')).toBe('2026');
  });
});
