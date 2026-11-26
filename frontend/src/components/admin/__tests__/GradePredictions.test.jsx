// @vitest-environment jsdom
// Group: match-operations. Grading works on one season: regrade asks first, names the season, and sends the division
// and that season. Results and failures are shown inline; no browser dialogs are used.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const completed = [{ id: 'm1', home_team_name: 'Alpha', away_team_name: 'Beta', home_score: 1, away_score: 0, is_graded: false, season_id: 's1', season_name: '2026 season' }];
vi.mock('../../../hooks/useApi', () => ({ useApi: () => ({ data: { data: completed }, refetch: vi.fn(), loading: false }) }));
vi.mock('../DivisionSwitch', () => ({ DivisionSwitch: () => null }));
vi.mock('../../../lib/api', () => ({ API_BASE_URL: 'http://api.test' }));
vi.mock('../../../lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } } }));
const { default: GradePredictions } = await import('../GradePredictions');
const { ConfirmProvider } = await import('../../ui');

let urls;
beforeEach(() => {
  urls = [];
  vi.stubGlobal('fetch', vi.fn(async (url) => { urls.push(url); return { ok: true, json: async () => ({ success: true, message: 'Regraded 4 predictions in 2026 season.' }) }; }));
  vi.spyOn(window, 'confirm').mockImplementation(() => { throw new Error('window.confirm must not be used'); });
  vi.spyOn(window, 'alert').mockImplementation(() => { throw new Error('window.alert must not be used'); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('GradePredictions regrade', () => {
  it('asks before regrading the season, then sends the division and that season', async () => {
    render(<ConfirmProvider><GradePredictions /></ConfirmProvider>);
    fireEvent.click(screen.getByRole('button', { name: /regrade season/i }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/2026 season/)).toBeTruthy();
    expect(urls).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Regrade season' }));
    expect(await screen.findByText('Regraded 4 predictions in 2026 season.')).toBeTruthy();
    expect(urls).toEqual(['http://api.test/admin/predictions/regrade-all?division=super-league&season=s1']);
  });
});
