// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MatchStrip } from '../MatchStrip';

const match = {
  id: 'm1', status: 'live', minute: 34, home_score: 0, away_score: 1,
  home: { name: 'Slough House' }, away: { name: "Taverner's Unit" },
};

const renderStrip = (props) => render(<MemoryRouter><MatchStrip match={props.match} featured={props.featured} /></MemoryRouter>);

describe('MatchStrip', () => {
  afterEach(cleanup);

  it('shows the minute on a live match', () => {
    renderStrip({ match });
    expect(screen.getByText("Live 34'")).toBeTruthy();
  });

  it('puts the featured live pill on the block ink, not live red', () => {
    renderStrip({ match, featured: true });
    const pill = screen.getByText("Live 34'");
    expect(pill.className).toContain('text-blkink');
    expect(pill.className).not.toContain('text-live');
  });
});
