// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TopNavbar } from '../../components/TopNavbar';
import { DivisionHomeRoute } from '../DivisionHomeRoute';
import { SectionGate } from '../SectionGate';

const context = vi.hoisted(() => ({ league: null }));
vi.mock('../../context/LeagueContext', () => ({ useLeague: () => context.league }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));

function league(scope = {}) {
  context.league = {
    division: 'inter', fantasySection: 'season1', setFantasySection: vi.fn(),
    setDivision: vi.fn(), setSeasonSlug: vi.fn(),
    seasonScope: {
      ready: true, division: 'inter', divisionRecord: { name: 'Inter' }, requestedSeasonSlug: null,
      season: { slug: '2026' }, seasons: [],
      sections: [
        { key: 'rules', label: 'Competition rules', enabled: true, navVisible: true },
        { key: 'fixtures', label: 'Calendar', enabled: true, navVisible: false },
        { key: 'teams', label: 'Teams', enabled: false, navVisible: true },
        { key: 'registration', label: 'Apply', enabled: true, navVisible: true },
        { key: 'overview', label: 'Overview', enabled: true, navVisible: true },
      ],
      ...scope,
    },
  };
}

afterEach(cleanup);

it('lists enabled, nav-visible implemented sections in configured order', () => {
  league();
  render(<MemoryRouter><TopNavbar /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
  const labels = screen.getAllByRole('button').map((button) => button.textContent);
  expect(labels).toContain('COMPETITION RULES');
  expect(labels.indexOf('COMPETITION RULES')).toBeLessThan(labels.indexOf('OVERVIEW'));
  expect(screen.queryByRole('button', { name: 'CALENDAR' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'TEAMS' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'APPLY' })).toBeNull();
});

it('blocks a disabled section and allows an enabled nav-hidden section by direct URL', () => {
  league();
  render(<MemoryRouter>
    <SectionGate section="teams"><p>Team content</p></SectionGate>
    <SectionGate section="fixtures"><p>Fixture content</p></SectionGate>
  </MemoryRouter>);
  expect(screen.queryByText('Team content')).toBeNull();
  expect(screen.getByText('This section is not available for this season.')).toBeTruthy();
  expect(screen.getByText('Fixture content')).toBeTruthy();
});

it('offers public seasons in a division without a current season', () => {
  league({ season: null, seasons: [{ id: 'older', slug: '2025', name: '2025' }] });
  render(<MemoryRouter initialEntries={['/inter']}><Routes>
    <Route path="/:division" element={<DivisionHomeRoute><p>Overview content</p></DivisionHomeRoute>} />
  </Routes></MemoryRouter>);
  expect(screen.getByRole('link', { name: '2025' }).getAttribute('href')).toBe('/inter/2025');
  expect(screen.queryByText('Overview content')).toBeNull();
});

it('shows the empty state for a known public division without public seasons', () => {
  league({ season: null });
  render(<MemoryRouter initialEntries={['/inter']}><Routes>
    <Route path="/:division" element={<DivisionHomeRoute />} />
  </Routes></MemoryRouter>);
  expect(screen.getByText('No public seasons yet.')).toBeTruthy();
});
