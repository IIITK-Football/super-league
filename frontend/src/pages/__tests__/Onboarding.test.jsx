// @vitest-environment jsdom
// Group: frontend-components. Onboarding (SL-025): the World Cup flair request carries the session token (the API
// refuses writes without one), and the profile is saved by updating the user's own row without an email (the email is
// the Auth account's and is not writable through the Data API); a missing row is created without an email.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    from: (table) => {
      if (table === 'wc_teams') return { select: () => ({ order: async () => ({ data: [{ id: 'br', name: 'Brazil' }] }) }) };
      return {
        update: (values) => ({ eq: (col, id) => ({ select: async () => { calls.updates.push({ values, col, id }); return { data: updatedRows, error: null }; } }) }),
        insert: async (row) => { calls.inserts.push(row); return { error: null }; },
      };
    },
  },
}));
const { Onboarding } = await import('../Onboarding.jsx');

beforeEach(() => {
  calls.updates = []; calls.inserts = []; calls.fetches = [];
  updatedRows = [{ id: 'u1' }];
  setProfile.mockReset();
  vi.stubGlobal('fetch', vi.fn(async (url, init) => { calls.fetches.push({ url, init }); return new Response('{}', { status: 200 }); }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function submit() {
  render(<Onboarding />);
  await screen.findByRole('option', { name: 'Brazil' });
  fireEvent.change(screen.getByPlaceholderText('e.g. MasterPredictor99'), { target: { value: 'Ace' } });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Brazil' } });
  fireEvent.click(screen.getByText('Enter The League'));
  await waitFor(() => expect(setProfile).toHaveBeenCalled());
}

describe('onboarding save', () => {
  it('sends the session token with the flair request', async () => {
    await submit();
    const flair = calls.fetches.find((c) => c.url === '/api/wc/flair');
    expect(flair.init.method).toBe('PATCH');
    expect(flair.init.headers.Authorization).toBe('Bearer tok');
  });

  it("updates the user's own profile without an email", async () => {
    await submit();
    expect(calls.updates).toEqual([{ values: { nickname: 'Ace', wc_team_flair: 'Brazil' }, col: 'id', id: 'u1' }]);
    expect(calls.inserts).toEqual([]);
  });

  it('creates a missing profile row without an email', async () => {
    updatedRows = [];
    await submit();
    expect(calls.inserts).toEqual([{ id: 'u1', nickname: 'Ace', wc_team_flair: 'Brazil' }]);
  });
});
