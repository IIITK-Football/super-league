// @vitest-environment jsdom
// Group: frontend-components. The shared FUT card (Clubs player page and the dictator forms): portrait or a shield,
// rating and the six canonical stats (older flat values convert), the one play style's catalog icon, optional season
// position, optional details (foot and play style), an unsaved picture labelled as such, and dashes instead of
// invented numbers.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import FutCard from '../FutCard';

afterEach(cleanup);
const card = (name) => screen.getByRole('figure', { name: `FUT card: ${name}` });

describe('FutCard', () => {
  it('shows the identity card with canonical stats, play style icon and season position', () => {
    render(<FutCard position="ST" player={{ first_name: 'Ada', last_name: 'Striker', overall_rating: 86, image_url: 'https://x/p.png',
      attributes: { stats: { Pace: { total: 81 } }, shooting: 64, playStyle: 'Power Shot' } }} />);
    const c = card('Ada Striker');
    expect(within(c).getByRole('img', { name: 'Ada Striker portrait' }).getAttribute('src')).toBe('https://x/p.png');
    expect(within(c).getByTestId('card-rating').textContent).toBe('86');
    expect(c.textContent).toMatch(/ST/);
    expect(c.textContent).toMatch(/PAC81/);
    expect(c.textContent).toMatch(/SHO64/); // an older flat value, converted
    expect(c.textContent).toMatch(/PAS-/);
    expect(within(c).getByRole('img', { name: 'Power Shot' }).getAttribute('src')).toMatch(/powershot\.png$/); // from the catalog
  });

  it('shows dashes and no position for an empty draft, and the details caption on request', () => {
    render(<FutCard details player={{ first_name: '', last_name: '', overall_rating: '', attributes: {} }} />);
    const c = card('Unnamed player');
    expect(within(c).getByTestId('card-rating').textContent).toBe('-');
    expect(c.textContent).not.toMatch(/RES/);
    expect(c.textContent).toMatch(/Preferred foot: not set/);
    expect(c.textContent).toMatch(/Play style: not set/);
  });

  it('labels a picture that is not saved, and one that failed', () => {
    const player = { first_name: 'Ada', image_url: 'https://x/old.png', attributes: {} };
    const { rerender } = render(<FutCard player={player} portrait={{ url: 'blob:new', status: 'local' }} />);
    expect(within(card('Ada')).getByRole('img', { name: 'Ada portrait' }).getAttribute('src')).toBe('blob:new');
    expect(card('Ada').textContent).toMatch(/not saved yet/);
    rerender(<FutCard player={player} portrait={{ url: 'blob:new', status: 'failed' }} />);
    expect(card('Ada').textContent).toMatch(/did not save/);
  });
});
