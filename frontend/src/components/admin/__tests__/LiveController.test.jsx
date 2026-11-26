// @vitest-environment jsdom
// Group: match-operations. The live tab works on match events: the list of events, a banner for goals without a scorer,
// +1 and -1 score steps, attributing and correcting a goal with the version the scorer saw, voiding with a required
// reason, cards, a chooser when -1 has no unattributed goal, and clear inline messages for loading, empty, errors and
// version conflicts. Each action sends exactly one request to the live route.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = { events: [], eventsError: null, requests: [], responses: [], selects: 0, format: 'league' };
const match = { id: 'm1', home_team_id: 't1', away_team_id: 't2', home_team_name: 'Alpha', away_team_name: 'Beta', home_score: 1, away_score: 0, status: 'live', minute: "20'", division_name: 'D', season_name: 'S', season_id: 's1' };
const players = [
  { id: 'p1', first_name: 'Ada', last_name: 'Striker', team_id: 't1' },
  { id: 'p2', first_name: 'Bea', last_name: 'Winger', team_id: 't1' },
  { id: 'p3', first_name: 'Cy', last_name: 'Keeper', team_id: 't2' },
];

vi.mock('../../../hooks/useApi', () => ({
  useApi: (endpoint) => ({ data: endpoint.startsWith('/players') ? { data: players } : { data: [match] }, refetch: vi.fn(), loading: false }),
}));
vi.mock('../DivisionSwitch', () => ({ DivisionSwitch: () => null }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ hasRole: (r) => r === 'scorer' }) }));
vi.mock('../../../lib/api', () => ({ API_BASE_URL: 'http://api.test' }));
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
    from: (table) => {
      if (table === 'seasons') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { format: db.format }, error: null }) }) }) };
      const b = { select: () => b, eq: () => b, is: () => b, order: () => b, then: (res, rej) => Promise.resolve().then(() => { db.selects += 1; return db.eventsError ? { data: null, error: { message: db.eventsError } } : { data: db.events.map((e) => ({ ...e })), error: null }; }).then(res, rej) };
      return b;
    },
  },
}));
const { ConfirmProvider } = await import('../../ui');
const { default: LiveController } = await import('../LiveController');
const renderLive = () => render(<ConfirmProvider><LiveController /></ConfirmProvider>);

const goal = (over) => ({ id: 'e1', team_id: 't1', kind: 'goal', player_id: null, assist_player_id: null, minute: 20, added_minute: null, version: 1, ...over });

beforeEach(() => {
  match.home_score = 1; match.away_score = 0; db.format = 'league';
  db.events = [goal({})]; db.eventsError = null; db.requests = []; db.responses = []; db.selects = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    db.requests.push(JSON.parse(init.body));
    const next = db.responses.shift() ?? { status: 200, body: { success: true, message: 'Done.', match: { home_score: 2, away_score: 0 } } };
    return { ok: next.status < 400, status: next.status, json: async () => next.body };
  }));
  vi.spyOn(window, 'prompt').mockImplementation(() => { throw new Error('window.prompt must not be used'); });
  vi.spyOn(window, 'confirm').mockImplementation(() => { throw new Error('window.confirm must not be used'); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function openMatch() {
  renderLive();
  fireEvent.click(await screen.findByText(/Alpha vs Beta/));
  await screen.findByText(/Match events \(/);
}

describe('LiveController on match events', () => {
  it('lists the events, flags a goal without a scorer and offers Attribute', async () => {
    await openMatch();
    expect(screen.getByText('Match events (1)')).toBeTruthy();
    expect(screen.getByText(/1 goal unattributed/)).toBeTruthy();
    expect(within(screen.getByTestId('match-event')).getByText('Unknown scorer')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Attribute' })).toBeTruthy();
  });

  it('shows the empty state and an error with retry', async () => {
    db.events = [];
    await openMatch();
    expect(screen.getByText('No events recorded yet.')).toBeTruthy();
    cleanup();
    db.eventsError = 'permission denied';
    renderLive();
    fireEvent.click(await screen.findByText(/Alpha vs Beta/));
    expect(await screen.findByText(/Events could not be loaded \(permission denied\)/)).toBeTruthy();
    db.eventsError = null;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Match events (0)')).toBeTruthy();
  });

  it('Goal for a team records a goal at the clock minute with no scorer, as one add_event request', async () => {
    await openMatch();
    fireEvent.click(screen.getByRole('button', { name: 'Goal for Alpha' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Done.'));
    expect(db.requests).toHaveLength(1);
    expect(db.requests[0]).toMatchObject({ match_id: 'm1', action: 'add_event', event: { kind: 'goal', team_id: 't1', minute: '20' } });
    expect(db.requests[0].event.player_id).toBeUndefined();
    expect(db.requests[0].event.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByLabelText('Home score').textContent).toBe('2');
  });

  it('-1 removes the newest unattributed goal of that side as one score_step request', async () => {
    await openMatch();
    fireEvent.click(screen.getByLabelText('Minus one home'));
    await waitFor(() => expect(db.requests).toHaveLength(1));
    expect(db.requests[0]).toMatchObject({ match_id: 'm1', action: 'score_step', side: 'home', delta: -1 });
  });

  it('attributes the goal with the version the scorer saw, as one edit_event request', async () => {
    await openMatch();
    fireEvent.click(screen.getByRole('button', { name: 'Attribute' }));
    expect(screen.getByText('Correct Goal')).toBeTruthy();
    expect(screen.getByDisplayValue('Alpha (Home)')).toBeTruthy(); // the goal's team is preselected
    fireEvent.change(screen.getByLabelText('Goalscorer'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText('Minute'), { target: { value: '22' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    await waitFor(() => expect(db.requests).toHaveLength(1));
    expect(db.requests[0]).toEqual({ match_id: 'm1', action: 'edit_event', event_id: 'e1', version: 1, changes: { kind: 'goal', team_id: 't1', player_id: 'p1', assist_player_id: null, minute: '22' } });
  });

  it('a stale version is explained, the list is reloaded, and nothing else is sent', async () => {
    db.responses = [{ status: 409, body: { success: false, message: 'This event changed since you loaded it. Review the current version and try again.' } }];
    await openMatch();
    const loadsBefore = db.selects;
    fireEvent.click(screen.getByRole('button', { name: 'Attribute' }));
    fireEvent.change(screen.getByLabelText('Goalscorer'), { target: { value: 'p1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/changed since you loaded it/);
    expect(db.requests).toHaveLength(1);
    await waitFor(() => expect(db.selects).toBeGreaterThan(loadsBefore));
  });

  it('voids an event only after a reason is given in a confirm dialog', async () => {
    await openMatch();
    fireEvent.click(screen.getByLabelText('Void event'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove event' }));
    expect(await within(dialog).findByText('Give a reason to remove this event.')).toBeTruthy();
    expect(db.requests).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'wrong player' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove event' }));
    await waitFor(() => expect(db.requests).toHaveLength(1));
    expect(db.requests[0]).toEqual({ match_id: 'm1', action: 'void_event', event_id: 'e1', version: 1, reason: 'wrong player' });
  });

  it('-1 with every goal attributed shows the chooser, and a chosen goal is voided with its version', async () => {
    db.events = [goal({ player_id: 'p1', version: 3 })];
    db.responses = [{ status: 409, body: { success: false, message: 'Every goal for that side has a scorer. Choose the goal to correct.', candidates: [goal({ player_id: 'p1', version: 3 })] } }];
    await openMatch();
    fireEvent.click(screen.getByLabelText('Minus one home'));
    const chooser = await screen.findByRole('group', { name: 'Choose the goal to correct' });
    expect(within(chooser).getByText(/Ada Striker/)).toBeTruthy();
    fireEvent.click(within(chooser).getByRole('button', { name: 'Void this goal' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'wrong player' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove event' }));
    await waitFor(() => expect(db.requests).toHaveLength(2));
    expect(db.requests[1]).toMatchObject({ action: 'void_event', event_id: 'e1', version: 3, reason: 'wrong player' });
  });

  it('adds a card with a player, as one add_event request', async () => {
    await openMatch();
    fireEvent.click(screen.getByRole('button', { name: 'Add Card' }));
    fireEvent.change(screen.getByLabelText('Card team'), { target: { value: 't2' } });
    fireEvent.change(screen.getByLabelText('Carded player'), { target: { value: 'p3' } });
    fireEvent.change(screen.getByLabelText('Card minute'), { target: { value: '55' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Card' }));
    await waitFor(() => expect(db.requests).toHaveLength(1));
    expect(db.requests[0]).toMatchObject({ action: 'add_event', event: { kind: 'yellow', team_id: 't2', player_id: 'p3', minute: '55' } });
  });

  it('half time keeps the minutes played, as Pause does, and the second half resumes from them', async () => {
    await openMatch();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: /set/i }));
    await waitFor(() => expect(db.requests).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /start/i }));
    await waitFor(() => expect(db.requests).toHaveLength(2));
    const started = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(started + 12 * 60000);
    fireEvent.click(screen.getByRole('button', { name: 'Half Time' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Half time' }));
    await waitFor(() => expect(db.requests).toHaveLength(3));
    expect(db.requests[2]).toMatchObject({ action: 'update_time', minute: 'HT', timer_start_time: null, timer_calibration: 42 });
    Date.now.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: /start/i }));
    await waitFor(() => expect(db.requests).toHaveLength(4));
    expect(db.requests[3]).toMatchObject({ action: 'update_time', minute: "42'", timer_calibration: 42 });
  });

  it('does not start the clock on screen when the server refuses the save, and says why', async () => {
    db.responses = [{ status: 500, body: { success: false, message: 'Database timeout' } }];
    await openMatch();
    fireEvent.click(screen.getByRole('button', { name: /start/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Database timeout/);
    expect(screen.queryByRole('button', { name: /pause/i })).toBeNull();
    expect(screen.getByRole('button', { name: /start/i })).toBeTruthy();
  });

  it('shows the clock as running only after the server stored the start', async () => {
    await openMatch();
    fireEvent.click(screen.getByRole('button', { name: /start/i }));
    expect(await screen.findByRole('button', { name: /pause/i })).toBeTruthy();
    expect(db.requests[0]).toMatchObject({ action: 'update_time', minute: "20'", timer_calibration: 20 });
    expect(db.requests[0].timer_start_time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('takes a tied knockout to penalties: both scores are required, and only then is the match closed', async () => {
    match.away_score = 1; db.format = 'knockout';
    await openMatch();
    fireEvent.click(screen.getByRole('button', { name: 'Final whistle' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.change(within(dialog).getByLabelText('Home penalties'), { target: { value: '4' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'End match' }));
    expect(await within(dialog).findByText('Enter both penalty scores.')).toBeTruthy();
    expect(db.requests).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText('Away penalties'), { target: { value: '3' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'End match' }));
    await waitFor(() => expect(db.requests).toHaveLength(1));
    expect(db.requests[0]).toMatchObject({ action: 'close_match', home_penalties: 4, away_penalties: 3 });
  });

  it('asks for no penalties in a league match, even a draw', async () => {
    match.away_score = 1;
    await openMatch();
    fireEvent.click(screen.getByRole('button', { name: 'Final whistle' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).queryByLabelText('Home penalties')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'End match' }));
    await waitFor(() => expect(db.requests).toHaveLength(1));
    expect(db.requests[0]).toEqual({ match_id: 'm1', action: 'close_match' });
  });

  it('shows a server refusal inline', async () => {
    db.responses = [{ status: 403, body: { success: false, message: 'Forbidden: you are not assigned to score this match.' } }];
    await openMatch();
    fireEvent.click(screen.getByRole('button', { name: 'Goal for Beta' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/not assigned to score/);
  });
});
