// @vitest-environment jsdom
// Group: frontend-components. News images upload THROUGH the API (multipart to /admin/newsletter/image with the
// session token), never to a presigned storage URL; the article is published with the public URL the API returns;
// an upload refusal is shown and nothing is published.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } } }));
vi.mock('../../../hooks/useApi', () => ({ useApi: () => ({ data: { data: [] }, refetch: vi.fn() }) }));
vi.mock('../../../lib/api', () => ({ API_BASE_URL: '/api' }));
const { default: ManageNews } = await import('../ManageNews.jsx');

let calls;
let uploadResponse;
beforeEach(() => {
  calls = [];
  uploadResponse = { status: 200, body: { success: true, publicUrl: 'https://pub-news.r2.dev/news/abc.png' } };
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    calls.push({ url, init });
    if (url === '/api/admin/newsletter/image') return new Response(JSON.stringify(uploadResponse.body), { status: uploadResponse.status });
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }));
  vi.stubGlobal('alert', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fillAndSubmit() {
  render(<ManageNews />);
  fireEvent.change(screen.getByPlaceholderText('Headline / Title'), { target: { value: 'Final report' } });
  fireEvent.change(screen.getByPlaceholderText('Short Summary (Subtitle)'), { target: { value: 'A summary' } });
  fireEvent.change(screen.getByPlaceholderText('Write a paragraph...'), { target: { value: 'Body' } });
  const [hero] = document.querySelectorAll('input[type="file"]');
  fireEvent.change(hero, { target: { files: [new File(['x'], 'my photo.png', { type: 'image/png' })] } });
  fireEvent.click(screen.getByText('Publish Article'));
}

describe('news image upload', () => {
  it('uploads the image through the API and publishes with the returned public URL', async () => {
    fillAndSubmit();
    await waitFor(() => expect(calls.some((c) => c.url === '/api/admin/newsletter')).toBe(true));
    const upload = calls.find((c) => c.url === '/api/admin/newsletter/image');
    expect(upload.init.method).toBe('POST');
    expect(upload.init.headers.Authorization).toBe('Bearer tok');
    expect(upload.init.body).toBeInstanceOf(FormData);
    expect(upload.init.body.get('image').name).toBe('my photo.png');
    expect(calls.some((c) => /upload-url|r2\.cloudflarestorage/.test(c.url))).toBe(false);
    const publish = calls.find((c) => c.url === '/api/admin/newsletter');
    expect(JSON.parse(publish.init.body).image_url).toBe('https://pub-news.r2.dev/news/abc.png');
  });

  it('shows the refusal and publishes nothing when the upload is refused', async () => {
    uploadResponse = { status: 403, body: { success: false, error: 'Only an editor or a dictator can upload news images.' } };
    fillAndSubmit();
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Failed to publish: Only an editor or a dictator can upload news images.'));
    expect(calls.some((c) => c.url === '/api/admin/newsletter')).toBe(false);
  });
});
