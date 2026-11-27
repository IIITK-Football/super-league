// @vitest-environment jsdom
// Group: frontend-components. The knockout bracket is read from season data: the final and the third-place match
// each sit under their own label, and a season without knockout data shows no bracket at all.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { SeasonBracket, bracketRounds } from '../SeasonBracket';

const match = (id, stage) => ({ id, stage, status: 'scheduled', date: null, home: { name: `Home ${id}` }, away: { name: `Away ${id}` } });

afterEach(cleanup);

describe('bracketRounds', () => {
  it('labels the final as Final and the third-place match separately', () => {
    const rounds = bracketRounds([match('f', 'final'), match('t', 'third_place')]);
    expect(rounds.map((r) => [r.label, r.matches.map((m) => m.id)])).toEqual([
      ['Final', ['f']],
      ['Third place play-off', ['t']],
    ]);
  });

  it('leaves out rounds with no matches', () => {
    expect(bracketRounds([match('s', 'semi_final')]).map((r) => r.label)).toEqual(['Semi-finals']);
  });

  it('is empty when the season has no knockout data', () => {
    expect(bracketRounds([{ id: 'x', status: 'completed' }])).toEqual([]);
  });
});

describe('SeasonBracket', () => {
  it('renders nothing without knockout data', () => {
    const { container } = render(<MemoryRouter><SeasonBracket matches={[{ id: 'x' }]} /></MemoryRouter>);
    expect(container.textContent).toBe('');
  });

  it('shows the final under its own heading', () => {
    render(<MemoryRouter><SeasonBracket matches={[match('f', 'final')]} /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Final', level: 3 })).toBeTruthy();
    expect(screen.queryByText(/Loser/)).toBeNull();
  });
});
