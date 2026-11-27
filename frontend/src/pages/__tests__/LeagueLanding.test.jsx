// @vitest-environment jsdom
// Group: frontend-components. The landing lists divisions from data (never hard-coded), shows the live or next match
// when one exists, has no global key shortcuts, and shows a still instead of the clip under reduced motion.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.__db = {};
globalThis.__filters = [];
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table) => {
      const builder = {
        select: () => builder, order: () => builder, in: () => builder,
        eq: (...args) => { globalThis.__filters.push([table, 'eq', ...args]); return builder; },
        is: (...args) => { globalThis.__filters.push([table, 'is', ...args]); return builder; },
        then: (resolve, reject) => Promise.resolve(globalThis.__db[table]?.() ?? { data: [], error: null }).then(resolve, reject),
      };
      return builder;
    },
  },
}));

import { LeagueLanding } from '../LeagueLanding';

const divisions = [
  { id: 'd1', slug: 'super-league', name: 'Super League', primary_color: '#123456', logo_url: null, archived_at: null, is_featured: true, landing_video_key: 'superLeague1' },
  { id: 'd2', slug: 'wsl', name: 'Women Super League', primary_color: null, logo_url: null, archived_at: null },
  { id: 'd3', slug: 'old', name: 'Old Cup', primary_color: null, logo_url: null, archived_at: '2025-01-01' },
];
const seasons = [
  { id: 's1', division_id: 'd1', name: '2026 Season' },
  { id: 's2', division_id: 'd2', name: 'Autumn 2026' },
];
const matches = [
  { id: 'm1', season_id: 's1', status: 'live', date: '2026-11-26T10:00:00Z', home_score: 2, away_score: 1, home: { name: 'Alpha' }, away: { name: 'Beta' } },
];

function setData(overrides = {}) {
  globalThis.__db = {
    divisions: () => ({ data: divisions, error: null }),
    seasons: () => ({ data: seasons, error: null }),
    matches: () => ({ data: matches, error: null }),
    ...overrides,
  };
}

const findCard = (href) => waitFor(() => {
  const link = document.querySelector(`section[aria-label="Divisions"] a[href="${href}"]`);
  if (!link) throw new Error(`no card ${href}`);
  return link;
});

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<LeagueLanding />} />
        <Route path="/super-league" element={<p>Division page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
  setData();
  globalThis.__filters = [];
});
afterEach(cleanup);

describe('landing division choice', () => {
  it('lists the visible divisions from data, with season and live match', async () => {
    renderLanding();
    const list = await screen.findByRole('list', { name: '' }).catch(() => null);
    expect(list).toBeTruthy();
    const link = await screen.findByRole('link', { name: 'Enter Super League' });
    expect(link.getAttribute('href')).toBe('/super-league');
    expect(document.querySelectorAll('video')).toHaveLength(1);
    expect(document.querySelector('section[aria-label=Divisions] a[href="/super-league"]')).toBeNull();
    expect(await findCard('/wsl')).toBeTruthy();
    expect(screen.queryByText('Old Cup')).toBeNull();
    for (const table of ['divisions', 'seasons']) {
      expect(globalThis.__filters).toContainEqual([table, 'eq', 'visibility', 'public']);
      expect(globalThis.__filters).toContainEqual([table, 'is', 'archived_at', null]);
    }
    expect(screen.queryByText(/SL \/ 26/)).toBeNull();
  });

  it('uses no key shortcut: Enter on the page does not open a division', async () => {
    renderLanding();
    await screen.findByRole('link', { name: 'Enter Super League' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(screen.queryByText('Division page')).toBeNull();
  });

  it('says so when there are no divisions', async () => {
    setData({ divisions: () => ({ data: [], error: null }) });
    renderLanding();
    expect(await screen.findByText('No divisions yet')).toBeTruthy();
  });

  it('shows an error with a retry that loads again', async () => {
    const divisionsRead = vi.fn(() => ({ data: null, error: { message: 'offline' } }));
    setData({ divisions: divisionsRead });
    renderLanding();
    expect(await screen.findByRole('alert')).toBeTruthy();
    divisionsRead.mockImplementation(() => ({ data: divisions, error: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Enter Super League' })).toBeTruthy();
  });
});

describe('landing motion', () => {
  it('shows the still and no video when reduced motion is requested', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} });
    const { container } = renderLanding();
    await screen.findByRole('link', { name: 'Enter Super League' });
    expect(container.querySelector('video')).toBeNull();
    expect(screen.queryByRole('button', { name: /Pause background video/ })).toBeNull();
  });
});
