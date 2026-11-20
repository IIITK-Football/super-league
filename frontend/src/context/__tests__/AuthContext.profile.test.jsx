// @vitest-environment jsdom
// Group: frontend-components. The profile is read with explicit public columns (SL-025): the email column is not
// readable through the Data API, so selecting * would fail; the user's email comes from the session instead.
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const selects = [];
vi.mock('../../lib/supabase', () => {
  const user = { id: 'u1', email: 'me@iiitkottayam.ac.in' };
  return {
    supabase: {
      auth: {
        getSession: async () => ({ data: { session: { user } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signOut: async () => ({}),
      },
      from: () => {
        const b = {
          select: (cols) => { selects.push(cols); return b; },
          eq: () => b,
          maybeSingle: async () => ({ data: { id: 'u1', nickname: 'Ace' }, error: null }),
        };
        return b;
      },
      rpc: async () => ({ data: [], error: null }),
    },
  };
});
const { AuthProvider } = await import('../AuthContext.jsx');

afterEach(cleanup);

describe('profile read', () => {
  it('selects only public profile columns, never email or *', async () => {
    render(<AuthProvider><div /></AuthProvider>);
    await waitFor(() => expect(selects.length).toBeGreaterThan(0));
    for (const cols of selects) {
      expect(cols).not.toBe('*');
      expect(cols).not.toMatch(/email/);
    }
    expect(selects).toContain('id, real_name, nickname, team_flair_id, wc_team_flair, created_at');
  });
});
