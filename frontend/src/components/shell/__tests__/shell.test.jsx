// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: null, profile: null, roles: null, hasRole: () => false, loading: false, signOut: vi.fn() }),
}));
vi.mock('../../../context/LeagueContext', () => ({
  useLeague: () => ({ division: 'super-league', fantasySection: 'fifa', setFantasySection: vi.fn(), setDivision: vi.fn() }),
}));
const divisionsState = { divisions: [], loading: true };
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
  it('keeps the legacy menu on /wc, not the new bottom tabs', () => {
    shellAt('/wc');
    // The legacy menu lists these entries (in the DOM, opened from its hamburger).
    expect(screen.getByText('FANTASY')).toBeTruthy();
    expect(screen.getByText('LEGENDS')).toBeTruthy();
    expect(screen.getByText('page body')).toBeTruthy();
    expect(document.querySelector('nav[aria-label="Main"].md\\:hidden')).toBeNull();
  });

  it('uses the new shell elsewhere', () => {
    shellAt('/super-league');
    expect(screen.queryByText('LEGENDS')).toBeNull();
    expect(document.querySelector('nav[aria-label="Main"].md\\:hidden')).not.toBeNull();
  });
});

describe('division paths', () => {
  it('links the sections to the division in view', () => {
    shellAt('/super-league');
    const hrefs = [...document.querySelectorAll('nav[aria-label="Main"] a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/super-league/matches');
    expect(hrefs).toContain('/super-league/news');
    expect(hrefs).toContain('/standings/super-league');
    expect(hrefs.some((h) => h === '/vault' || h === '/matches')).toBe(false);
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
