// @vitest-environment jsdom
// Group: frontend-components. "Your player card" on /profile against a fake Data API: loading, unlinked, error with
// retry; a linked player sees their card (rating, stats, play style read-only) and seasons, previews a new portrait and
// preferred foot on the card, and saves exactly the portrait URL and foot through update_my_player, after uploading to
// the own-portrait route. A failed upload changes nothing and offers a retry; Save is off until something changed.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MyPlayerCard from '../../components/players/MyPlayerCard';

const rpc = vi.fn();
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (...a) => rpc(...a), auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } } }));
vi.mock('../../lib/api', () => ({ API_BASE_URL: 'http://api.test/api' }));

const me = {
  id: 'p1', first_name: 'Ada', last_name: 'Striker', image_url: 'https://media.example/players/p1.png', overall_rating: 70,
  attributes: { stats: { Pace: { total: 80 } }, playStyle: 'Power Shot', bio: { preferredFoot: 'Right', height: 170 } },
  email: 'ada@iiitkottayam.ac.in',
  seasons: [{ season: '2026', division: 'WSL', team: 'Alpha', jersey_number: 9, position: 'ST', is_current: true }],
};
const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'me.png', { type: 'image/png' });
const card = () => screen.getByRole('region', { name: 'Your player card' });

beforeEach(() => {
  rpc.mockReset();
  globalThis.fetch = vi.fn();
  URL.createObjectURL = vi.fn(() => 'blob:local');
  // Pictures are measured before they are shown: a 500 x 500 image loads at once.
  vi.stubGlobal('Image', class { set src(v) { this._src = v; setTimeout(() => { this.naturalWidth = 500; this.naturalHeight = 500; this.onload?.(); }, 0); } });
});
afterEach(() => cleanup());

describe('your player card', () => {
  it('shows loading, then explains how to get linked when no player is linked', async () => {
    let resolve;
    rpc.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    render(<MyPlayerCard />);
    expect(card().getAttribute('aria-busy')).toBe('true');
    await act(async () => resolve({ data: null, error: null }));
    expect(screen.getByText(/No player is linked to your account/)).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: 'Preferred foot' })).toBeNull();
  });

  it('reports a load failure and retries', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'offline' } }).mockResolvedValueOnce({ data: me, error: null });
    render(<MyPlayerCard />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/offline/));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('radiogroup', { name: 'Preferred foot' })).toBeTruthy());
  });

  it('shows the card read-only except portrait and foot, and the seasons', async () => {
    rpc.mockResolvedValueOnce({ data: me, error: null });
    render(<MyPlayerCard />);
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Right' }).getAttribute('aria-checked')).toBe('true'));
    expect(card().textContent).toMatch(/Play style: Power Shot/);
    expect(within(card()).getByText('70')).toBeTruthy();
    expect(screen.queryByLabelText(/rating|first name|pace|play style/i)).toBeNull();
    expect(within(screen.getByRole('list', { name: 'Your seasons' })).getByText(/WSL · 2026 \(current\): Alpha · #9 · ST/)).toBeTruthy();
    expect(card().textContent).toMatch(/Email: ada@iiitkottayam.ac.in \(your sign-in email; it cannot be changed here\)/);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: /save card/i }).disabled).toBe(true);
  });

  it('previews and saves a new portrait and foot, sending only those', async () => {
    rpc.mockImplementation(async (name) => (name === 'my_player' ? { data: me, error: null } : { data: null, error: null }));
    fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, imageUrl: 'https://media.example/players/p1.png?v2' }) });
    render(<MyPlayerCard />);
    await waitFor(() => expect(screen.getByRole('radiogroup', { name: 'Preferred foot' })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: 'Left' }));
    expect(card().textContent).toMatch(/Left/);
    fireEvent.change(screen.getByLabelText('Portrait file'), { target: { files: [png()] } });
    await waitFor(() => expect(within(card()).getByAltText('Ada Striker portrait').getAttribute('src')).toBe('blob:local'));
    fireEvent.click(screen.getByRole('button', { name: /save card/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/saved/));
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://api.test/api/profile/player-portrait');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect([...init.body.keys()]).toEqual(['image']);
    expect(rpc).toHaveBeenCalledWith('update_my_player', { p_image_url: 'https://media.example/players/p1.png?v2', p_preferred_foot: 'Left' });
    expect(rpc.mock.calls.filter(([n]) => n !== 'my_player')).toHaveLength(1);
  });

  it('a failed upload saves nothing and offers a retry', async () => {
    rpc.mockResolvedValue({ data: me, error: null });
    fetch.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ message: 'Choose a 500 x 500 PNG image.' }) });
    render(<MyPlayerCard />);
    await waitFor(() => expect(screen.getByLabelText('Portrait file')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Portrait file'), { target: { files: [png()] } });
    await waitFor(() => expect(within(card()).getByAltText('Ada Striker portrait').getAttribute('src')).toBe('blob:local'));
    fireEvent.click(screen.getByRole('button', { name: /save card/i }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/did not upload: Choose a 500 x 500 PNG image\. Nothing was changed/));
    expect(rpc).not.toHaveBeenCalledWith('update_my_player', expect.anything());
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('removes the portrait, and reports a refused save', async () => {
    rpc.mockImplementation(async (name) => (name === 'my_player' ? { data: me, error: null } : { data: null, error: { message: 'No player is linked to your account' } }));
    render(<MyPlayerCard />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove portrait' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Remove portrait' }));
    expect(within(card()).queryByAltText('Ada Striker portrait')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /save card/i }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/not saved: No player is linked/));
    expect(rpc).toHaveBeenCalledWith('update_my_player', { p_image_url: null, p_preferred_foot: 'Right' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
