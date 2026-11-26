// @vitest-environment jsdom
// Group: frontend-components. A division section outranks a season of the same division, so /<division>/matches is
// never read as a season called "matches", and the division-less addresses are still routed.
import { describe, expect, it, vi } from 'vitest';
import { matchRoutes } from 'react-router-dom';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../Fantasy', () => ({ Fantasy: () => null }));
vi.mock('../LeagueLanding', () => ({ LeagueLanding: () => null }));
vi.mock('../../components/Loader', () => ({ Loader: () => null }));
import { routes } from '../../App';

const matched = (path) => matchRoutes(routes, path).at(-1).route.path;

describe('division routes', () => {
  it('routes each section of any division by its address', () => {
    expect(matched('/super-league/matches')).toBe('/:division/matches');
    expect(matched('/wsl/teams')).toBe('/:division/teams');
    expect(matched('/wsl/teams/abc')).toBe('/:division/teams/:teamId');
    expect(matched('/freshers/news')).toBe('/:division/news');
    expect(matched('/inter/rules')).toBe('/:division/rules');
  });

  it('keeps a season address for the division home', () => {
    expect(matched('/super-league/2026')).toBe('/:division/:season');
  });

  it('keeps the division-less addresses, the World Cup and the article routes', () => {
    expect(matched('/matches')).toBe('/matches');
    expect(matched('/teams')).toBe('/teams');
    expect(matched('/vault')).toBe('/vault');
    expect(matched('/rules')).toBe('/rules');
    expect(matched('/wc')).toBe('/wc');
    expect(matched('/article/12')).toBe('/article/:id');
    expect(matched('/matches/42')).toBe('/matches/:id');
  });
});
