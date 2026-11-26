// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Table } from '../Table';
import { Crest, initials } from '../Crest';
import { Scoreline } from '../Scoreline';

afterEach(cleanup);

describe('Table', () => {
  it('pins the first column with sticky classes and names the table with its caption', () => {
    const { container } = render(
      <Table caption="Standings">
        <thead><tr><th>Club</th><th>Pts</th></tr></thead>
        <tbody><tr><td>Lions</td><td>12</td></tr></tbody>
      </Table>,
    );
    expect(screen.getByRole('table', { name: 'Standings' })).toBeTruthy();
    expect(container.querySelector('table').className).toContain('[&_th:first-child]:sticky');
    expect(container.querySelector('.overflow-x-auto')).not.toBeNull();
  });
});

describe('Crest', () => {
  it('shows initials when there is no image', () => {
    render(<Crest name="Super League" />);
    expect(screen.getByRole('img', { name: 'Super League' }).textContent).toBe('SL');
    expect(initials('al balal')).toBe('AB');
  });

  it('falls back to initials when the image fails to load', () => {
    render(<Crest name="Kottayam FC" src="/missing.png" />);
    fireEvent.error(screen.getByRole('img', { name: 'Kottayam FC crest' }));
    expect(screen.getByRole('img', { name: 'Kottayam FC' }).textContent).toBe('KF');
  });
});

describe('Scoreline', () => {
  it('shows a dash for a missing score, never zero', () => {
    render(<Scoreline home={2} away={null} />);
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('–')).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('animates only when live', () => {
    const { container, rerender } = render(<Scoreline home={1} away={0} live />);
    expect(container.querySelector('.motion-safe\\:animate-tick')).not.toBeNull();
    rerender(<Scoreline home={1} away={0} />);
    expect(container.querySelector('.motion-safe\\:animate-tick')).toBeNull();
  });
});
