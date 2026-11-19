// @vitest-environment jsdom
// Group: frontend-components. The division homepage's season choice: the dropdown appears only when a division has
// more than one available season, defaults to the current one, follows and updates the address (/wsl/2027), reports
// an unknown season, and falls back to the API's current season if the seasons cannot be loaded.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = { seasons: [], seasonsError: null };

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: (table) => {
      const b = {
        select: () => b,
        eq: () => b,
        order: () => b,
        maybeSingle: async () => ({ data: table === 'divisions' ? { id: 'd-wsl', slug: 'wsl', name: 'WSL' } : null, error: null }),
        then: (resolve) => resolve(table === 'seasons'
          ? { data: state.seasonsError ? null : state.seasons, error: state.seasonsError }
          : { data: [], error: null }),
      };
      return b;
    },
  },
}));

// The loader's animation library needs a real canvas; a text stand-in keeps the loading state visible.
vi.mock('../../components/Loader', () => ({ Loader: ({ text }) => <p>{text || 'Loading'}</p> }));

const fetchMock = vi.fn(async () => ({
  json: async () => ({ success: true, data: { standings: [], news: [], fantasyTop: [], liveMatch: null, topScorer: null, topAssist: null } }),
}));

import { LeagueProvider } from '../../context/LeagueContext';
import { DivisionHomeRoute } from '../DivisionHomeRoute';
import { Home } from '../Home';

const season = (slug, current = false) => ({ id: `s-${slug}`, slug, name: slug, is_current: current, starts_on: `${slug}-08-01`, ends_on: null, format: 'knockout' });

function Where() {
  const location = useLocation();
  return <p data-testid="path">{location.pathname}</p>;
}

function renderAt(path) {
  return render(
    <LeagueProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/wsl" element={<DivisionHomeRoute division="wsl"><Home /><Where /></DivisionHomeRoute>} />
          <Route path="/wsl/:season" element={<DivisionHomeRoute division="wsl"><Home /><Where /></DivisionHomeRoute>} />
        </Routes>
      </MemoryRouter>
    </LeagueProvider>,
  );
}

const requestedUrls = () => fetchMock.mock.calls.map(([url]) => String(url));
const lastQuery = () => new URL(requestedUrls().at(-1), 'http://x').searchParams;

beforeEach(() => {
  state.seasons = [];
  state.seasonsError = null;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('season choice on the division homepage', () => {
  it('hides the dropdown when the division has one season, and asks for that division', async () => {
    state.seasons = [season('2026', true)];
    renderAt('/wsl');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastQuery().get('division')).toBe('wsl');
    expect(lastQuery().get('season')).toBe('2026');
    expect(screen.queryByLabelText('Season')).toBeNull();
  });

  it('shows the dropdown with two seasons, defaulting to the current one', async () => {
    state.seasons = [season('2027'), season('2026', true)];
    renderAt('/wsl');
    const select = await screen.findByLabelText('Season');
    expect(select.value).toBe('2026');
    expect([...select.options].map((o) => o.textContent)).toEqual(['2026 (current)', '2027']);
    expect(lastQuery().get('season')).toBe('2026');
  });

  it('changing the season updates the address and the content request', async () => {
    state.seasons = [season('2027'), season('2026', true)];
    renderAt('/wsl');
    fireEvent.change(await screen.findByLabelText('Season'), { target: { value: '2027' } });
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/wsl/2027'));
    await waitFor(() => expect(lastQuery().get('season')).toBe('2027'));
    expect((await screen.findByLabelText('Season')).value).toBe('2027');
  });

  it('opens the season named in the address (/wsl/2027)', async () => {
    state.seasons = [season('2027'), season('2026', true)];
    renderAt('/wsl/2027');
    expect((await screen.findByLabelText('Season')).value).toBe('2027');
    expect(requestedUrls().every((u) => new URL(u, 'http://x').searchParams.get('season') === '2027')).toBe(true);
  });

  it('choosing the current season goes back to the plain division address', async () => {
    state.seasons = [season('2027'), season('2026', true)];
    renderAt('/wsl/2027');
    fireEvent.change(await screen.findByLabelText('Season'), { target: { value: '2026' } });
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/wsl'));
  });

  it('reports an unknown season with a link to the current one, and requests nothing', async () => {
    state.seasons = [season('2026', true)];
    renderAt('/wsl/1999');
    expect(await screen.findByText(/season not found/i)).toBeTruthy();
    expect(screen.getByText(/no season "1999" in WSL/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /current season/i }).getAttribute('href')).toBe('/wsl');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the current season through the API when the seasons cannot be loaded', async () => {
    state.seasonsError = { message: 'network down' };
    renderAt('/wsl');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastQuery().get('division')).toBe('wsl');
    expect(lastQuery().has('season')).toBe(false);
    expect(screen.queryByLabelText('Season')).toBeNull();
  });
});
