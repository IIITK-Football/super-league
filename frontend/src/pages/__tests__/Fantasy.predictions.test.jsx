// @vitest-environment jsdom
// Group: frontend-components. League predictions (Season 1): upcoming matches only, a fresh form per match, stale
// responses ignored, and a failed history load shown as an error rather than an empty list.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const future = new Date(Date.now() + 86400000 * 3).toISOString();
const schedule = [
  { id: 'done', home_team: 'Old', away_team: 'Match', home_team_id: 'h0', away_team_id: 'a0', date: '2020-01-01T10:00:00Z', status: 'completed' },
  { id: 'm1', home_team: 'Alpha', away_team: 'Beta', home_team_id: 'h1', away_team_id: 'a1', date: future, status: 'scheduled' },
  { id: 'm2', home_team: 'Gamma', away_team: 'Delta', home_team_id: 'h2', away_team_id: 'a2', date: future, status: 'scheduled' },
];

const fx = { prediction: {}, history: { ok: true, body: { success: true, data: [] } } };
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, profile: { nickname: 'Ace', wc_team_flair: 'Brazil' } }) }));
vi.mock('../../context/LeagueContext', () => ({
  scopeQuery: () => 'division=super-league',
  useLeague: () => ({
    division: 'super-league',
    seasonScope: { ready: true, division: 'super-league', season: { slug: 's1' }, seasons: [{ slug: 's1' }], divisionRecord: { id: 'd1' } },
    fantasySection: 'season1',
    setFantasySection: vi.fn(),
  }),
}));
vi.mock('../../hooks/useApi', () => ({
  fetchApi: vi.fn(),
  useApi: (endpoint) => ({
    data: endpoint === '/schedule' ? { data: schedule } : endpoint === '/players' ? { data: [] } : { data: { data: { overall: [] } } },
    error: null, loading: false, refetch: vi.fn(), retry: vi.fn(),
  }),
}));
vi.mock('../../lib/api', () => ({ API_BASE_URL: '/api' }));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
  },
}));
vi.mock('../FifaPrediction', () => ({ FifaPrediction: () => <div>fifa</div> }));
vi.mock('../Login', () => ({ Login: () => <div>login</div> }));
vi.mock('../Onboarding', () => ({ Onboarding: () => <div>onboarding</div> }));
vi.mock('../../components/Loader', () => ({ Loader: () => <div>loading</div> }));

import { Fantasy } from '../Fantasy';

function respond(url) {
  if (url.startsWith('/api/predictions/history')) {
    return fx.history.ok ? Response.json(fx.history.body) : Response.json({ error: 'nope' }, { status: 500 });
  }
  const id = url.split('/').pop().split('?')[0];
  if (fx.prediction[id]) return fx.prediction[id]();
  return Response.json({ success: true, has_predicted: false });
}

beforeEach(() => {
  fx.prediction = {};
  fx.history = { ok: true, body: { success: true, data: [] } };
  vi.stubGlobal('fetch', vi.fn(async (url) => respond(String(url))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const matchSelect = () => screen.getByLabelText('Match');

describe('league predictions', () => {
  it('lists only matches that have not kicked off', () => {
    render(<MemoryRouter><Fantasy /></MemoryRouter>);
    const options = within(matchSelect()).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Choose a match', 'Alpha vs Beta', 'Gamma vs Delta']);
  });

  it('clears the score and the locked state when another match is chosen', async () => {
    fx.prediction.m1 = () => Response.json({ success: true, has_predicted: false });
    render(<MemoryRouter><Fantasy /></MemoryRouter>);
    fireEvent.change(matchSelect(), { target: { value: 'm1' } });
    fireEvent.change(await screen.findByLabelText('Home score'), { target: { value: '2' } });
    fireEvent.change(matchSelect(), { target: { value: 'm2' } });
    await waitFor(() => expect(screen.getByLabelText('Home score').value).toBe(''));
  });

  it('ignores a late answer for the match that is no longer chosen', async () => {
    let releaseM1;
    fx.prediction.m1 = () => new Promise((resolve) => { releaseM1 = () => resolve(Response.json({ success: true, has_predicted: true })); });
    render(<MemoryRouter><Fantasy /></MemoryRouter>);
    fireEvent.change(matchSelect(), { target: { value: 'm1' } });
    await waitFor(() => expect(releaseM1).toBeDefined());
    fireEvent.change(matchSelect(), { target: { value: 'm2' } });
    expect(await screen.findByLabelText('Home score')).toBeTruthy();
    releaseM1();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/prediction locked/i)).toBeNull();
    expect(screen.getByLabelText('Home score')).toBeTruthy();
  });

  it('shows an error, not the empty copy, when the history cannot load', async () => {
    fx.history = { ok: false };
    render(<MemoryRouter><Fantasy /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText(/no predictions yet/i)).toBeNull();
  });

  it('names the standings "Prediction table"', () => {
    render(<MemoryRouter><Fantasy /></MemoryRouter>);
    expect(screen.getByRole('tab', { name: 'Prediction table' })).toBeTruthy();
  });
});
