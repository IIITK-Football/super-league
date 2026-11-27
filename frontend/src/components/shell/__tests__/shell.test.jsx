// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: null, profile: null, roles: null, hasRole: () => false, loading: false, signOut: vi.fn() }),
}));
vi.mock('../../../context/LeagueContext', () => ({
  useLeague: () => ({ division: 'super-league', seasonScope: { season: null, sections: sectionsState, divisionRecord: null }, fantasySection: 'fifa', setFantasySection: vi.fn(), setDivision: vi.fn() }),
}));
const divisionsState = { divisions: [], loading: true };
const sectionsState = ['overview', 'fixtures', 'standings', 'teams', 'stats', 'fantasy', 'news', 'rules'].map((key, order) => ({ key, label: ({ overview: 'Home', fixtures: 'Matches', standings: 'Table', teams: 'Clubs', stats: 'Player stats', fantasy: 'Predictions', news: 'News', rules: 'Rules' })[key], order, enabled: true, navVisible: true }));
vi.mock('../../../hooks/useDivisions', () => ({ useDivisions: () => divisionsState }));

import { AppShell } from '../AppShell';
import { DivisionSwitcher } from '../DivisionSwitcher';

afterEach(() => {
  cleanup();
  divisionsState.divisions = [];
  divisionsState.loading = true;
});

const shellAt = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <AppShell><p>page body</p></AppShell>
  </MemoryRouter>,
);

describe('World Cup navigation stays frozen', () => {
  it('keeps the legacy menu on /wc, not the new menu', () => {
    shellAt('/wc');
    // The legacy menu lists these entries (in the DOM, opened from its hamburger).
    expect(screen.getByText('WORLD CUP')).toBeTruthy();
    expect(screen.getByText('page body')).toBeTruthy();
    expect(document.querySelector('#site-menu')).toBeNull();
  });

  it('uses the new shell elsewhere, with its menu closed and inert', () => {
    shellAt('/super-league');
    expect(screen.queryByText('LEGENDS')).toBeNull();
    const menu = document.querySelector('#site-menu');
    expect(menu).not.toBeNull();
    expect(menu.hasAttribute('inert')).toBe(true);
    expect(screen.getByRole('button', { name: 'Open menu' }).getAttribute('aria-expanded')).toBe('false');
  });
});

describe('division paths', () => {
  it('hides disabled and navigation-hidden sections', () => {
    sectionsState.find((s) => s.key === 'fixtures').enabled = false;
    sectionsState.find((s) => s.key === 'rules').navVisible = false;
    try {
      shellAt('/super-league');
      expect(document.querySelector('a[href="/super-league/matches"]')).toBeNull();
      expect(document.querySelector('a[href="/super-league/rules"]')).toBeNull();
    } finally {
      sectionsState.find((s) => s.key === 'fixtures').enabled = true;
      sectionsState.find((s) => s.key === 'rules').navVisible = true;
    }
  });
  it('links the sections to the division in view', () => {
    shellAt('/super-league');
    const hrefs = [...document.querySelectorAll('nav[aria-label="Sections"] a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/super-league/matches');
    expect(hrefs).toContain('/super-league/news');
    expect(hrefs).toContain('/standings/super-league');
    expect(hrefs.some((h) => h === '/vault' || h === '/matches')).toBe(false);
  });
});

describe('header bar', () => {
  it('puts the five main sections in the bar and lights the one in view', () => {
    shellAt('/super-league/matches');
    const links = [...document.querySelectorAll('nav[aria-label="Main"] a')];
    expect(links.map((a) => a.textContent)).toEqual(['Home', 'Matches', 'Table', 'Stats', 'News']);
    expect(links.filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.textContent)).toEqual(['Matches']);
  });

  it('keeps the division switcher in the menu, not the bar', () => {
    divisionsState.divisions = [{ slug: 'super-league', name: 'Super League', short_name: 'SL' }, { slug: 'wsl', name: 'WSL' }];
    divisionsState.loading = false;
    shellAt('/super-league');
    expect(document.querySelector('#site-menu nav[aria-label="Divisions"]')).not.toBeNull();
    expect(document.querySelector('header nav[aria-label="Divisions"]')).toBeNull();
  });
});

describe('menu contents', () => {
  it('carries only the sections the header pill does not show, at the widths where the pill is there', () => {
    const mediaQuery = window.matchMedia;
    window.matchMedia = (query) => ({ matches: query === '(min-width: 1024px)', addEventListener: vi.fn(), removeEventListener: vi.fn() });
    try {
      shellAt('/super-league');
      const labels = [...document.querySelectorAll('#site-menu nav[aria-label="Sections"] .sm-panel-itemLabel')].map((node) => node.textContent);
      expect(labels).toEqual(['Clubs', 'Predictions', 'Rules']);
    } finally {
      window.matchMedia = mediaQuery;
    }
  });
});

describe('DivisionSwitcher label', () => {
  it('shows a skeleton, not the slug, while divisions load', () => {
    const { container } = render(
      <MemoryRouter>
        <DivisionSwitcher divisions={[]} loading division="super-league" current={undefined} />
      </MemoryRouter>,
    );
    expect(screen.queryByText('super-league')).toBeNull();
    expect(container.querySelector('[class*="animate-pulse"]')).not.toBeNull();
  });

  it('shows the display name from data once loaded', () => {
    render(
      <MemoryRouter>
        <DivisionSwitcher
          divisions={[{ slug: 'super-league', name: 'Super League' }]}
          loading={false}
          division="super-league"
          current={{ slug: 'super-league', name: 'Super League' }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Super League', { selector: 'span.truncate' })).toBeTruthy();
    expect(screen.queryByText('super-league', { selector: 'span.truncate' })).toBeNull();
  });
});
