// @vitest-environment jsdom
// Group: match-operations. Regrading all seasons requires confirmation.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const completed = [{ id: 'm1', home_team_name: 'Alpha', away_team_name: 'Beta', home_score: 1, away_score: 0, is_graded: false, season_id: 's1', season_name: '2026 season' }];
vi.mock('../../../hooks/useApi', () => ({ useApi: () => ({ data: { data: completed }, refetch: vi.fn(), loading: false }) }));
vi.mock('../DivisionSwitch', () => ({ DivisionSwitch: () => null }));
vi.mock('../../../lib/api', () => ({ API_BASE_URL: 'http://api.test' }));
vi.mock('../../../lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } } }));
const { default: GradePredictions } = await import('../GradePredictions');
const { ConfirmProvider } = await import('../../ui');
const { readToasts } = await import('../../ui/toastStore');

let urls;
beforeEach(() => {
  urls = [];
  vi.stubGlobal('fetch', vi.fn(async (url) => { urls.push(url); return { ok: true, json: async () => ({ success: true, message: 'Regraded 4 predictions in 2026 season.' }) }; }));
  vi.spyOn(window, 'confirm').mockImplementation(() => { throw new Error('window.confirm must not be used'); });
  vi.spyOn(window, 'alert').mockImplementation(() => { throw new Error('window.alert must not be used'); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('GradePredictions regrade', () => {
  it('asks before regrading all seasons', async () => {
    render(<ConfirmProvider><GradePredictions /></ConfirmProvider>);
    fireEvent.click(screen.getByRole('button', { name: /regrade all/i }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/across all seasons/)).toBeTruthy();
    expect(urls).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Regrade all' }));
    await waitFor(() => expect(readToasts().at(-1)?.title).toBe('Regraded 4 predictions in 2026 season.'));
    expect(urls).toEqual(['http://api.test/admin/predictions/regrade-all']);
  });
});
