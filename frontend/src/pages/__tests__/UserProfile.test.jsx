// @vitest-environment jsdom
// Group: frontend-components. Profile: club and nation lists have loading and error states, and the World Cup pick is
// saved through the one flair endpoint.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pick } from '../../test/controls';

const calls = { updates: [], flairs: [] };
let wcStatus;
const setProfile = vi.fn();
const auth = { user: { id: 'u1', email: 'a@iiitkottayam.ac.in' }, profile: { nickname: 'Ace', wc_team_flair: null }, setProfile, signOut: vi.fn() };
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../hooks/useApi', () => ({ useApi: () => ({ data: null, loading: false }) }));
vi.mock('../../hooks/useDivisions', () => ({ useDivisions: () => ({ divisions: [] }) }));
vi.mock('../../components/PasswordSettings', () => ({ PasswordSettings: () => <div>password settings</div> }));
vi.mock('../../components/players/MyPlayerCard', () => ({ default: () => <div>player card</div> }));
vi.mock('../../lib/api', () => ({ API_BASE_URL: '/api' }));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
    from: (table) => {
      if (table === 'seasons') return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
      if (table === 'division_flairs') return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
      return { update: (values) => ({ eq: async () => { calls.updates.push(values); return { error: null }; } }) };
    },
  },
}));

const { UserProfile } = await import('../UserProfile.jsx');

beforeEach(() => {
  calls.updates = []; calls.flairs = []; wcStatus = 'ready';
  setProfile.mockReset();
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (url === '/api/wc/teams') {
      return wcStatus === 'ready' ? Response.json({ success: true, data: [{ id: 'br', name: 'Brazil' }] }) : Response.json({ error: 'x' }, { status: 500 });
    }
    calls.flairs.push({ url, init });
    return Response.json({ success: true });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const renderPage = () => render(<MemoryRouter><UserProfile /></MemoryRouter>);

describe('profile', () => {
  it('saves a changed nickname to the own profile row', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /world cup nation/i }).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('Nickname'), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(setProfile).toHaveBeenCalled());
    expect(calls.updates).toEqual([{ nickname: 'Ada' }]);
    expect(calls.flairs).toEqual([]);
  });

  it('saves a chosen World Cup nation through the flair endpoint, not the profile row', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /world cup nation/i }).disabled).toBe(false));
    await pick(/world cup nation/i, 'Brazil');
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(calls.flairs.length).toBe(1));
    expect(calls.flairs[0].url).toBe('/api/wc/flair');
    expect(JSON.parse(calls.flairs[0].init.body)).toEqual({ user_id: 'u1', wc_team_flair: 'Brazil' });
    expect(calls.updates).toEqual([{ nickname: 'Ace' }]);
  });

  it('says the nation list failed, with a retry, and still lets the nickname be saved', async () => {
    wcStatus = 'error';
    renderPage();
    expect(await screen.findByText(/nation list could not be loaded/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /world cup nation/i })).toBeNull();
    fireEvent.change(screen.getByLabelText('Nickname'), { target: { value: 'Ada' } });
    expect(screen.getByRole('button', { name: /save changes/i }).disabled).toBe(false);
  });
});
