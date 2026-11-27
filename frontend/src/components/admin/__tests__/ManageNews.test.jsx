// @vitest-environment jsdom
// Group: frontend-components. Editors write and edit articles but never delete (the API refuses it and the button is
// not shown). News images upload THROUGH the API (multipart, session token); an article is published with the public
// URL the API returns; a refusal or a bad file is shown inline and nothing is published.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ roles: ['editor'], articles: [], refetch: null }));
vi.mock('../../../lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } } }));
vi.mock('../../../hooks/useApi', () => ({ useApi: () => ({ data: { data: state.articles }, loading: false, error: null, retry: state.refetch }) }));
vi.mock('../../../lib/api', () => ({ API_BASE_URL: '/api' }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ roles: state.roles }) }));
const { default: ManageNews } = await import('../ManageNews.jsx');
const { ConfirmProvider } = await import('../../ui/ConfirmProvider.jsx');
const { readToasts } = await import('../../ui/toastStore');

let calls;
let replies;
const reply = (url, method, status, body) => { replies[`${method} ${url}`] = { status, body }; };

beforeEach(() => {
  calls = [];
  replies = {};
  state.roles = ['editor'];
  state.articles = [];
  state.refetch = vi.fn();
  reply('/api/admin/newsletter/image', 'POST', 200, { success: true, publicUrl: 'https://pub-news.r2.dev/news/abc.png' });
  reply('/api/admin/newsletter', 'POST', 200, { success: true });
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, init });
    const r = replies[`${method} ${url}`] ?? replies[`${method} ${url.split('?')[0]}`] ?? { status: 200, body: { success: true } };
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status });
  }));
  vi.stubGlobal('alert', vi.fn());
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderPage = () => render(<ConfirmProvider><ManageNews /></ConfirmProvider>);
const ARTICLE = {
  id: 'a1',
  title: 'Matchday one',
  summary: 'The opener',
  category: 'Match Report',
  date: '2026-11-20T10:00:00Z',
  image_url: null,
  content: [{ type: 'paragraph', value: 'Full text' }, { type: 'quote', value: 'Great game', author: 'Coach' }],
};

function fillForm({ title = 'Final report', summary = 'A summary' } = {}) {
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: title } });
  fireEvent.change(screen.getByLabelText('Summary'), { target: { value: summary } });
  fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Body' } });
}

const pick = (input, file) => fireEvent.change(input, { target: { files: [file] } });

describe('news image upload', () => {
  it('uploads the image through the API and publishes with the returned public URL', async () => {
    renderPage();
    fillForm();
    pick(screen.getByLabelText('Hero image'), new File(['x'], 'my photo.png', { type: 'image/png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish article' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/admin/newsletter')).toBe(true));
    const upload = calls.find((c) => c.url === '/api/admin/newsletter/image');
    expect(upload.init.method).toBe('POST');
    expect(upload.init.headers.Authorization).toBe('Bearer tok');
    expect(upload.init.body).toBeInstanceOf(FormData);
    expect(upload.init.body.get('image').name).toBe('my photo.png');
    expect(calls.some((c) => /upload-url|r2\.cloudflarestorage/.test(c.url))).toBe(false);
    const publish = calls.find((c) => c.url === '/api/admin/newsletter');
    expect(JSON.parse(publish.init.body).image_url).toBe('https://pub-news.r2.dev/news/abc.png');
    await waitFor(() => expect(readToasts().at(-1)?.title).toBe('Article published.'));
    expect(alert).not.toHaveBeenCalled();
  });

  it('shows the server message inline and publishes nothing when the upload is refused', async () => {
    reply('/api/admin/newsletter/image', 'POST', 403, { success: false, error: 'Only an editor or a dictator can upload news images.' });
    renderPage();
    fillForm();
    pick(screen.getByLabelText('Hero image'), new File(['x'], 'p.png', { type: 'image/png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish article' }));
    expect(await screen.findByText('Only an editor or a dictator can upload news images.')).toBeTruthy();
    expect(calls.some((c) => c.url === '/api/admin/newsletter')).toBe(false);
    expect(alert).not.toHaveBeenCalled();
  });

  it('reads a non-JSON error without crashing', async () => {
    reply('/api/admin/newsletter/image', 'POST', 502, '<html>bad gateway</html>');
    renderPage();
    fillForm();
    pick(screen.getByLabelText('Hero image'), new File(['x'], 'p.png', { type: 'image/png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish article' }));
    expect(await screen.findByText('Could not upload the image.')).toBeTruthy();
  });

  it('refuses an image over 10 MB before uploading it', async () => {
    renderPage();
    const big = new File(['x'], 'huge.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 });
    pick(screen.getByLabelText('Hero image'), big);
    expect(await screen.findByText('Images must be 10 MB or smaller.')).toBeTruthy();
    expect(URL.createObjectURL).not.toHaveBeenCalledWith(big);
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Publish article' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/admin/newsletter')).toBe(true));
    expect(calls.some((c) => c.url === '/api/admin/newsletter/image')).toBe(false);
  });

  it('shows a thumbnail preview of the chosen hero image', () => {
    renderPage();
    pick(screen.getByLabelText('Hero image'), new File(['x'], 'p.png', { type: 'image/png' }));
    expect(document.querySelector('img[src="blob:preview"]')).toBeTruthy();
  });
});

describe('deleting and editing', () => {
  it('shows no delete control to an editor', () => {
    state.articles = [ARTICLE];
    renderPage();
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit Matchday one' })).toBeTruthy();
  });

  it('lets a dictator delete after confirming, and reports a refused delete', async () => {
    state.roles = ['dictator'];
    state.articles = [ARTICLE];
    reply('/api/admin/newsletter', 'DELETE', 500, { success: false, message: 'Something broke' });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Matchday one' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete article' }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(true));
    expect(await screen.findByText('Something broke')).toBeTruthy();
    expect(state.refetch).not.toHaveBeenCalled();
  });

  it('edits an article with PUT and keeps its existing image', async () => {
    state.articles = [{ ...ARTICLE, image_url: 'https://pub-news.r2.dev/news/old.png' }];
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Matchday one' }));
    expect(screen.getByLabelText('Title').value).toBe('Matchday one');
    expect(screen.getByLabelText('Text').value).toBe('Full text');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Matchday one (fixed)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.init?.method === 'PUT');
    expect(put.url).toBe('/api/admin/newsletter?id=a1');
    const body = JSON.parse(put.init.body);
    expect(body).toMatchObject({ title: 'Matchday one (fixed)', image_url: 'https://pub-news.r2.dev/news/old.png' });
    expect(body.content[1]).toMatchObject({ type: 'quote', value: 'Great game', author: 'Coach' });
    expect(calls.some((c) => c.url === '/api/admin/newsletter/image')).toBe(false);
  });
});
