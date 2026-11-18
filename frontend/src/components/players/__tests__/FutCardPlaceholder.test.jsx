// @vitest-environment jsdom
// Group: frontend-components. The placeholder FUT card shows only the reusable player identity (name, portrait,
// overall rating, numeric attributes, play styles) and never season data such as jersey number or position.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import FutCardPlaceholder from '../FutCardPlaceholder';

afterEach(cleanup);

const player = {
  first_name: 'Asha',
  last_name: 'Varma',
  image_url: 'https://example.test/asha.png',
  overall_rating: 70,
  attributes: { pac: 81, sho: 66, notes: 'quick', playStyles: [{ name: 'Rapid' }, { name: 'Finesse Shot' }] },
};

describe('FutCardPlaceholder', () => {
  it('is labelled as a placeholder shared across seasons', () => {
    render(<FutCardPlaceholder player={player} />);
    const card = screen.getByRole('region', { name: 'FUT card (placeholder)' });
    expect(within(card).getByRole('heading', { name: 'FUT card · placeholder' })).toBeTruthy();
    expect(within(card).getByText(/Shared by this player in every season\. The finished card design will replace this placeholder\./)).toBeTruthy();
  });

  it('shows the portrait with an accessible name when there is an image', () => {
    render(<FutCardPlaceholder player={player} />);
    expect(screen.getByRole('img', { name: 'Asha Varma portrait' }).getAttribute('src')).toBe(player.image_url);
    expect(screen.getByText('Asha Varma')).toBeTruthy();
  });

  it('shows initials instead of an image when there is no portrait', () => {
    render(<FutCardPlaceholder player={{ ...player, image_url: null }} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('AV')).toBeTruthy();
  });

  it('shows the overall rating, numeric attributes and play styles, ignoring other values', () => {
    render(<FutCardPlaceholder player={player} />);
    expect(screen.getByText('OVR 70')).toBeTruthy();
    expect(screen.getByText('PAC')).toBeTruthy();
    expect(screen.getByText('81')).toBeTruthy();
    expect(screen.getByText('SHO')).toBeTruthy();
    expect(screen.getByText('Play styles: Rapid, Finesse Shot')).toBeTruthy();
    expect(screen.queryByText('NOTES')).toBeNull();
    expect(screen.queryByText('quick')).toBeNull();
    expect(screen.queryByText('PLAYSTYLES')).toBeNull();
  });

  it('shows at most six attributes', () => {
    const attributes = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 };
    const { container } = render(<FutCardPlaceholder player={{ ...player, attributes }} />);
    expect(container.querySelectorAll('dt')).toHaveLength(6);
    expect(screen.queryByText('G')).toBeNull();
  });

  it('renders nothing without a player', () => {
    const { container } = render(<FutCardPlaceholder player={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('never shows season data even when it is present on the object', () => {
    const { container } = render(
      <FutCardPlaceholder player={{ ...player, id: 'p-123', jersey_number: 9, position: 'ST', team: 'Falcons', goals: 12 }} />,
    );
    const text = container.textContent;
    expect(text).not.toMatch(/jersey|position|ST\b|Falcons|p-123|#9/i);
    expect(screen.queryByText('9')).toBeNull();
    expect(screen.queryByText('12')).toBeNull();
  });
});
