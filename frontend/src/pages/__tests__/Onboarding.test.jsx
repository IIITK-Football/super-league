// @vitest-environment jsdom
// Group: frontend-components. Onboarding asks for a nickname only. The World Cup champion pick is optional and is
// saved through the existing /wc/flair endpoint (with the session token) only when it is chosen.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pick } from '../../test/controls';

const calls = { updates: [], inserts: [], fetches: [] };
let updatedRows;
const setProfile = vi.fn();

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'me@iiitkottayam.ac.in' }, profile: null, setProfile, signOut: vi.fn() }),
}));
vi.mock('../../lib/api', () => ({ API_BASE_URL: '/api' }));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
    from: () => ({
      update: (values) => ({ eq: () => ({ select: async () => { calls.updates.push({ values }); return { data: updatedRows, error: null }; } }) }),
      insert: async (row) => { calls.inserts.push(row); return { error: null }; },
    }),
  },
}));
const { Onboarding } = await import('../Onboarding.jsx');

beforeEach(() => {
  calls.updates = []; calls.inserts = []; calls.fetches = [];
  updatedRows = [{ id: 'u1' }];
  setProfile.mockReset();
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    calls.fetches.push({ url, init });
    if (url === '/api/wc/teams') return Response.json({ success: true, data: [{ id: 'br', name: 'Brazil' }] });
    return Response.json({ success: true });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function fillNickname() {
  fireEvent.change(screen.getByLabelText(/nickname/i), { target: { value: 'Ace' } });
}
const enter = () => fireEvent.click(screen.getByRole('button', { name: /enter the league/i }));

describe('onboarding', () => {
  it('explains that the World Cup pick is optional and belongs to the World Cup predictor', async () => {
    render(<Onboarding />);
    await waitFor(() => expect(screen.getByRole('button', { name: /world cup champion/i }).disabled).toBe(false));
    expect(screen.getByText(/skip it if you like/i)).toBeTruthy();
    expect(screen.getByText(/belongs to the world cup predictor/i)).toBeTruthy();
  });

  it('saves the nickname alone when no World Cup pick is made', async () => {
    render(<Onboarding />);
    await waitFor(() => expect(screen.getByRole('button', { name: /world cup champion/i }).disabled).toBe(false));
    fillNickname();
    enter();
    await waitFor(() => expect(setProfile).toHaveBeenCalled());
    expect(calls.fetches.some((c) => c.url === '/api/wc/flair')).toBe(false);
    expect(calls.updates).toEqual([{ values: { nickname: 'Ace' } }]);
    expect(calls.inserts).toEqual([]);
  });

  it('saves a chosen World Cup pick through the flair endpoint with the session token', async () => {
    render(<Onboarding />);
    await waitFor(() => expect(screen.getByRole('button', { name: /world cup champion/i }).disabled).toBe(false));
    fillNickname();
    await pick(/world cup champion/i, 'Brazil');
    enter();
    await waitFor(() => expect(setProfile).toHaveBeenCalled());
    const flair = calls.fetches.find((c) => c.url === '/api/wc/flair');
    expect(flair.init.method).toBe('PATCH');
    expect(flair.init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(flair.init.body)).toEqual({ user_id: 'u1', wc_team_flair: 'Brazil' });
    expect(calls.updates).toEqual([{ values: { nickname: 'Ace' } }]);
  });

  it('creates a missing profile row without an email', async () => {
    updatedRows = [];
    render(<Onboarding />);
    await waitFor(() => expect(screen.getByRole('button', { name: /world cup champion/i }).disabled).toBe(false));
    fillNickname();
    enter();
    await waitFor(() => expect(setProfile).toHaveBeenCalled());
    expect(calls.inserts).toEqual([{ id: 'u1', nickname: 'Ace' }]);
  });

  it('keeps the World Cup pick required when the World Cup predictor asks for it', async () => {
    render(<Onboarding requireWorldCup />);
    await waitFor(() => expect(screen.getByRole('button', { name: /world cup champion/i }).disabled).toBe(false));
    fillNickname();
    expect(screen.getByText(/predictor needs this pick/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /enter the league/i }).disabled).toBe(true);
  });
});
