// @vitest-environment jsdom
// Group: frontend-components. Missing stats show a dash, a club button opens its full line, form shows the last five.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { StandingsTable } from '../StandingsTable';

const rows = [
  { teamId: 't1', teamName: 'AL Balal', rank: 1, form: ['W', 'D', 'W', 'L', 'W', 'W'], stats: { matchesPlayed: 3, won: 2, drawn: 1, lost: 0, goalsFor: 7, goalsAgainst: 2, goalDifference: 5, points: 7 } },
  { teamId: 't2', teamName: 'KFC', rank: 2, form: [], stats: { matchesPlayed: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: null, points: undefined } },
];

afterEach(cleanup);

describe('StandingsTable', () => {
  it('shows a dash for a missing value', () => {
    render(<MemoryRouter><StandingsTable rows={rows} /></MemoryRouter>);
    const kfc = screen.getByRole('row', { name: /KFC/ });
    expect(kfc.textContent).toContain('–');
  });

  it('a club button opens and closes its full line', () => {
    render(<MemoryRouter><StandingsTable rows={rows} /></MemoryRouter>);
    const button = screen.getByRole('button', { name: /AL Balal/ });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(button.getAttribute('aria-controls')).hidden).toBe(false);
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows the last five results and a signed goal difference', () => {
    render(<MemoryRouter><StandingsTable rows={rows} /></MemoryRouter>);
    expect(screen.getByRole('list', { name: 'Form: D, W, L, W, W' }).children).toHaveLength(5);
    expect(screen.getByRole('list', { name: 'Form: L, W, W' }).children).toHaveLength(3);
    expect(screen.getByText('+5')).toBeTruthy();
  });
});
