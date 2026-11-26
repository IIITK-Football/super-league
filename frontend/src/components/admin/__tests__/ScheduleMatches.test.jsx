// @vitest-environment jsdom
// Group: match-operations. The fixture form: a walkover or forfeit needs a reason, which is sent with the award;
// a team cannot play itself; every outcome is shown inline (no browser alerts).
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const teams = [{ id: 't1', name: 'Alpha' }, { id: 't2', name: 'Beta' }];
const fixtures = [{ id: 'm1', home_team_id: 't1', away_team_id: 't2', home_team_name: 'Alpha', away_team_name: 'Beta', home_score: 0, away_score: 0, status: 'scheduled', date: '2026-12-01T16:00:00Z', venue: 'Main Turf' }];
const seasons = [{ id: 's1', slug: '2026', name: '2026 season', is_current: true }, { id: 's0', slug: '2025', name: '2025 season', is_current: false }];
vi.mock('../../../hooks/useApi', () => ({
  useApi: (endpoint) => ({
    data: endpoint.startsWith('/teams') ? { data: teams } : endpoint.startsWith('/admin/matches') ? { data: fixtures } : { data: { bracketMatches: [] } },
    refetch: vi.fn(), loading: false,
  }),
}));
vi.mock('../../../hooks/useDivisions', () => ({ useDivisions: () => ({ divisions: [{ id: 'd1', slug: 'super-league', name: 'Super League' }], loading: false, error: '' }) }));
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: seasons, error: null }) }) }) }),
  },
}));
vi.mock('../DivisionSwitch', () => ({ DivisionSwitch: () => null }));
vi.mock('../../../pages/Standings', () => ({ WomensBracket: () => null, FreshersBracket: () => null }));
vi.mock('../../../lib/api', () => ({ API_BASE_URL: 'http://api.test' }));
const { default: ScheduleMatches } = await import('../ScheduleMatches');

let requests;
beforeEach(() => {
  requests = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    requests.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    return { ok: true, status: 200, json: async () => ({ success: true, message: 'ok' }) };
  }));
  vi.spyOn(window, 'alert').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function fillFixture() {
  await waitFor(() => expect(screen.getByLabelText('Season').value).toBe('s1'));
  fireEvent.change(screen.getByLabelText('Home team'), { target: { value: 't1' } });
  fireEvent.change(screen.getByLabelText('Away team'), { target: { value: 't2' } });
  fireEvent.change(screen.getByLabelText('Kickoff'), { target: { value: '2026-12-01T16:00' } });
  fireEvent.change(screen.getByLabelText('Venue'), { target: { value: 'Main Turf' } });
}

describe('ScheduleMatches walkovers and feedback', () => {
  it('asks for a reason before a walkover can be registered, and shows the gap inline', async () => {
    render(<ScheduleMatches />);
    await fillFixture();
    fireEvent.click(screen.getByLabelText(/Register as walkover/));
    fireEvent.change(screen.getByLabelText('Awarded to'), { target: { value: 'home' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register walkover' }));
    expect((await screen.findByText('Give a reason for the walkover.')).textContent).toBeTruthy();
    expect(requests).toHaveLength(0);
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('sends the reason and the awarded team with the walkover', async () => {
    render(<ScheduleMatches />);
    await fillFixture();
    fireEvent.click(screen.getByLabelText(/Register as walkover/));
    fireEvent.change(screen.getByLabelText('Awarded to'), { target: { value: 'away' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Beta did not field a side' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register walkover' }));
    expect(await screen.findByText(/Walkover registered/)).toBeTruthy();
    expect(requests[0].body).toMatchObject({ is_walkover: true, walkover_winner: 'away', walkover_reason: 'Beta did not field a side', division: 'super-league', season: 's1' });
  });

  it('refuses a team against itself inline', async () => {
    render(<ScheduleMatches />);
    await fillFixture();
    fireEvent.change(screen.getByLabelText('Away team'), { target: { value: 't1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule match' }));
    expect(await screen.findByText(/cannot play against itself/)).toBeTruthy();
    expect(requests).toHaveLength(0);
  });
});

describe('ScheduleMatches fixtures and seasons', () => {
  it('shows each fixture with its kickoff and venue, and the edit sheet starts from the stored venue', async () => {
    render(<ScheduleMatches />);
    const row = (await screen.findByText('Alpha vs Beta')).closest('tr');
    expect(within(row).getByText('Main Turf')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Alpha vs Beta' }));
    expect(within(await screen.findByRole('dialog')).getByLabelText('Venue').value).toBe('Main Turf');
  });

  it('lists the season fixtures, and edits one in a sheet with its teams and optional date and venue', async () => {
    render(<ScheduleMatches />);
    expect(await screen.findByText('Alpha vs Beta')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Alpha vs Beta' }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.change(within(sheet).getByLabelText('Venue'), { target: { value: 'Pitch 2' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save fixture' }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ method: 'PUT', body: { id: 'm1', home_team_id: 't1', away_team_id: 't2', venue: 'Pitch 2' } });
    expect(requests[0].body.date).toBeUndefined();
  });

  it('cancels a fixture only after a confirm, and reports a refusal inline', async () => {
    render(<ScheduleMatches />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel Alpha vs Beta' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(requests).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel fixture' }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ method: 'DELETE', url: expect.stringContaining('/admin/matches?id=m1') });
  });
});
