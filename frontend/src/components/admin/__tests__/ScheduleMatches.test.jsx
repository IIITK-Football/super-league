// @vitest-environment jsdom
// Group: match-operations. The fixture form: a walkover or forfeit needs a reason, which is sent with the award;
// a team cannot play itself; every outcome is shown inline (no browser alerts).
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const teams = [{ id: 't1', name: 'Alpha' }, { id: 't2', name: 'Beta' }];
vi.mock('../../../hooks/useApi', () => ({
  useApi: (endpoint) => ({ data: endpoint.startsWith('/teams') ? { data: teams } : { data: { bracketMatches: [] } }, refetch: vi.fn(), loading: false }),
}));
vi.mock('../DivisionSwitch', () => ({ DivisionSwitch: () => null }));
vi.mock('../../../pages/Standings', () => ({ WomensBracket: () => null, FreshersBracket: () => null }));
vi.mock('../../../lib/api', () => ({ API_BASE_URL: 'http://api.test' }));
vi.mock('../../../lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } },
}));
const { default: ScheduleMatches } = await import('../ScheduleMatches');

let requests;
beforeEach(() => {
  requests = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ success: true, message: 'ok' }) };
  }));
  vi.spyOn(window, 'alert').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fillFixture() {
  fireEvent.change(screen.getByLabelText('Home team'), { target: { value: 't1' } });
  fireEvent.change(screen.getByLabelText('Away team'), { target: { value: 't2' } });
  fireEvent.change(screen.getByLabelText('Kickoff'), { target: { value: '2026-12-01T16:00' } });
  fireEvent.change(screen.getByLabelText('Venue'), { target: { value: 'Main Turf' } });
}

describe('ScheduleMatches walkovers and feedback', () => {
  it('asks for a reason before a walkover can be registered, and shows the gap inline', async () => {
    render(<ScheduleMatches />);
    fillFixture();
    fireEvent.click(screen.getByLabelText(/Register as walkover/));
    fireEvent.change(screen.getByLabelText('Awarded to'), { target: { value: 'home' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register walkover' }));
    expect((await screen.findByText('Give a reason for the walkover.')).textContent).toBeTruthy();
    expect(requests).toHaveLength(0);
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('sends the reason and the awarded team with the walkover', async () => {
    render(<ScheduleMatches />);
    fillFixture();
    fireEvent.click(screen.getByLabelText(/Register as walkover/));
    fireEvent.change(screen.getByLabelText('Awarded to'), { target: { value: 'away' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Beta did not field a side' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register walkover' }));
    expect(await screen.findByText(/Walkover registered/)).toBeTruthy();
    expect(requests[0]).toMatchObject({ is_walkover: true, walkover_winner: 'away', walkover_reason: 'Beta did not field a side', division: 'super-league' });
  });

  it('refuses a team against itself inline', async () => {
    render(<ScheduleMatches />);
    fillFixture();
    fireEvent.change(screen.getByLabelText('Away team'), { target: { value: 't1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule match' }));
    expect(await screen.findByText(/cannot play against itself/)).toBeTruthy();
    expect(requests).toHaveLength(0);
  });
});
