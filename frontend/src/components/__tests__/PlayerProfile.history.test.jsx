// @vitest-environment jsdom
// Group: frontend-components. A player has one reusable card; goals and assists belong to a season. The player page
// asks for the season being browsed, shows one history line per season (team, number, position, goals, assists)
// and a labelled career line that adds them up, and handles a player with no seasons.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../context/LeagueContext', () => ({
  useLeague: () => ({ setView: vi.fn(), division: 'wsl', seasonScope: { season: { id: 's-2027' } } }),
}));

// The loading animation (Lottie) needs a canvas, which jsdom does not have.
vi.mock('../Loader', () => ({ Loader: ({ text }) => <p>{text}</p> }));

import PlayerProfile, { SeasonHistory } from '../PlayerProfile';

const player = {
  id: 'p1', name: 'Ada Striker', first_name: 'Ada', last_name: 'Striker', overall_rating: 72, attributes: {},
  position: 'CF', jersey_number: 10, team: 'Gamma', goals: 1, assists: 0,
  seasons: [
    { season: { id: 's-2027', slug: '2027', name: '2027' }, division: { slug: 'freshers', name: 'Freshers' }, team: { id: 't3', name: 'Gamma' }, jersey_number: 10, position: 'CF', goals: 1, assists: 0 },
    { season: { id: 's-2026', slug: '2026', name: '2026' }, division: { slug: 'wsl', name: 'WSL' }, team: { id: 't1', name: 'Alpha' }, jersey_number: 9, position: 'ST', goals: 2, assists: 1 },
  ],
  career: { seasons: 2, goals: 3, assists: 1 },
};

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('selectedPlayer', JSON.stringify({ id: 'p1' }));
  globalThis.fetch = vi.fn(async () => ({ json: async () => ({ success: true, data: player }) }));
});
afterEach(cleanup);

describe('player season history', () => {
  it('asks for the season being browsed', async () => {
    render(<PlayerProfile />);
    await screen.findByRole('region', { name: 'Season history' });
    expect(globalThis.fetch.mock.calls[0][0]).toMatch(/\/players\/p1\?season_id=s-2027$/);
  });

  it('shows one line per season and a career line that adds them up', () => {
    render(<SeasonHistory player={player} />);
    const table = within(screen.getByRole('region', { name: 'Season history' }));
    const rows = table.getAllByRole('row').map((r) => r.textContent);
    expect(rows[1]).toBe('Freshers 2027Gamma10CF10');
    expect(rows[2]).toBe('WSL 2026Alpha9ST21');
    expect(rows[3]).toBe('Career (2 seasons)31');
  });

  it('says so when the player has not played a season', () => {
    render(<SeasonHistory player={{ ...player, seasons: [], career: { seasons: 0, goals: 0, assists: 0 } }} />);
    expect(screen.getByText(/no seasons played yet/i)).toBeTruthy();
  });
});
