// @vitest-environment jsdom
// Group: frontend-components. News, article, rules and not-found pages: every state is distinct (loading, error with
// retry, empty, ready), an article shows only the metadata it really has, and rules belong to a division.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiState = { current: {} };
vi.mock('../../hooks/useApi', () => ({ useApi: vi.fn(() => apiState.current) }));

globalThis.__article = {};
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(globalThis.__article) }) }),
    }),
  },
}));

const leagueState = { current: {} };
vi.mock('../../context/LeagueContext', () => ({ useLeague: () => leagueState.current }));

import { Vault } from '../Vault';
import { ArticleView } from '../ArticleView';
import { Rules } from '../Rules';
import { NotFound } from '../NotFound';

const wrap = (ui, path = '/') => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

beforeEach(() => {
  apiState.current = { data: { data: [] }, error: null, loading: false, retry: vi.fn() };
  globalThis.__article = { data: null, error: null };
  leagueState.current = { division: 'super-league', seasonScope: { ready: true, divisionRecord: { name: 'Super League' }, season: null } };
});
afterEach(cleanup);

describe('news list', () => {
  it('is titled News and links each card to its article with its date', async () => {
    apiState.current = { data: { data: [{ id: 'a1', title: 'Opening day', date: '2026-11-20T00:00:00Z' }] }, error: null, loading: false, retry: vi.fn() };
    wrap(<Vault />);
    expect(screen.getByRole('heading', { level: 1, name: 'News' })).toBeTruthy();
    expect(screen.queryByText(/Onion/)).toBeNull();
    expect(screen.getByRole('link', { name: /Opening day/ }).getAttribute('href')).toBe('/article/a1');
  });

  it('keeps the category filter in place while the list loads', () => {
    apiState.current = { data: null, error: null, loading: true, retry: vi.fn() };
    wrap(<Vault />);
    expect(screen.getByLabelText('Category')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Loading news' })).toBeTruthy();
  });

  it('shows an error with retry, and a checked empty state', () => {
    const retry = vi.fn();
    apiState.current = { data: null, error: { message: 'Server error' }, loading: false, retry };
    const { unmount } = wrap(<Vault />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
    unmount();
    apiState.current = { data: { data: [] }, error: null, loading: false, retry };
    wrap(<Vault />);
    expect(screen.getByText('No articles in this category')).toBeTruthy();
  });
});

describe('article page', () => {
  it('shows not found only when no row exists', async () => {
    globalThis.__article = { data: null, error: null };
    wrap(<Routes><Route path="/article/:id" element={<ArticleView />} /></Routes>, '/article/0b1f2c3d-0000-4000-8000-000000000000');
    expect(await screen.findByText('Article not found')).toBeTruthy();
  });

  it('shows an error with retry when the request fails', async () => {
    globalThis.__article = { data: null, error: { message: 'down' } };
    wrap(<Routes><Route path="/article/:id" element={<ArticleView />} /></Routes>, '/article/0b1f2c3d-0000-4000-8000-000000000000');
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByText('Article not found')).toBeNull();
  });

  it('shows only the metadata the article has', async () => {
    globalThis.__article = { data: { id: 'x', title: 'Derby report', summary: 'Two goals.', content: [{ type: 'paragraph', value: 'Full text.' }], author: null, category: 'Match Reports', date: null }, error: null };
    wrap(<Routes><Route path="/article/:id" element={<ArticleView />} /></Routes>, '/article/0b1f2c3d-0000-4000-8000-000000000000');
    expect(await screen.findByRole('heading', { level: 1, name: 'Derby report' })).toBeTruthy();
    expect(screen.getByText('Match Reports')).toBeTruthy();
    expect(screen.queryByText(/Super League Media/)).toBeNull();
  });
});

describe('rules', () => {
  it('names the division, and never shows Super League rules for another division', () => {
    leagueState.current = { division: 'freshers', seasonScope: { ready: true, divisionRecord: { name: 'Freshers' }, season: null } };
    wrap(<Rules />);
    expect(screen.getByRole('heading', { level: 1, name: 'Freshers rules' })).toBeTruthy();
    expect(screen.queryByText('Super League rules')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Rosters & Player Eligibility' })).toBeTruthy();
  });

  it('shows an empty state for a division without published rules', () => {
    leagueState.current = { division: 'inter', seasonScope: { ready: true, divisionRecord: { name: 'Inter' }, season: null } };
    wrap(<Rules />);
    expect(screen.getByText('No rules published yet')).toBeTruthy();
  });
});

describe('not found', () => {
  it('says the page does not exist and links home', () => {
    wrap(<NotFound />);
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to home' }).getAttribute('href')).toBe('/');
  });
});
