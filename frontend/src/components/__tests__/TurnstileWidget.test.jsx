// @vitest-environment jsdom
// Group: auth-identity. The widget renders Cloudflare Turnstile only when a site key is set.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnstileWidget, turnstileSiteKey } from '../TurnstileWidget';

let api;
beforeEach(() => {
  api = { render: vi.fn().mockReturnValue('widget-1'), reset: vi.fn(), remove: vi.fn() };
  window.turnstile = api; // pretend Cloudflare's script is already loaded
});
afterEach(() => {
  cleanup();
  delete window.turnstile;
  vi.unstubAllEnvs();
  document.head.querySelectorAll('script[src*="turnstile"]').forEach((s) => s.remove());
});

describe('turnstileSiteKey', () => {
  it('is empty when not configured and trimmed when set', () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
    expect(turnstileSiteKey()).toBe('');
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', ' site-key ');
    expect(turnstileSiteKey()).toBe('site-key');
  });
});

describe('TurnstileWidget', () => {
  it('renders nothing and loads no script without a site key', () => {
    const { container } = render(<TurnstileWidget siteKey="" onToken={vi.fn()} />);
    expect(container.innerHTML).toBe('');
    expect(api.render).not.toHaveBeenCalled();
    expect(document.head.querySelector('script[src*="turnstile"]')).toBeNull();
  });

  it('renders the widget with the site key and reports tokens', async () => {
    const onToken = vi.fn();
    render(<TurnstileWidget siteKey="site-key" onToken={onToken} />);
    await vi.waitFor(() => expect(api.render).toHaveBeenCalledTimes(1));
    const [, options] = api.render.mock.calls[0];
    expect(options.sitekey).toBe('site-key');
    options.callback('token-1');
    expect(onToken).toHaveBeenLastCalledWith('token-1');
    options['expired-callback']();
    expect(onToken).toHaveBeenLastCalledWith(null);
  });

  it('resets the widget when the reset key changes', async () => {
    const { rerender } = render(<TurnstileWidget siteKey="site-key" onToken={vi.fn()} resetKey={0} />);
    await vi.waitFor(() => expect(api.render).toHaveBeenCalled());
    rerender(<TurnstileWidget siteKey="site-key" onToken={vi.fn()} resetKey={1} />);
    await vi.waitFor(() => expect(api.reset).toHaveBeenCalledWith('widget-1'));
  });

  it('removes the widget on unmount', async () => {
    const { unmount } = render(<TurnstileWidget siteKey="site-key" onToken={vi.fn()} />);
    await vi.waitFor(() => expect(api.render).toHaveBeenCalled());
    unmount();
    expect(api.remove).toHaveBeenCalledWith('widget-1');
  });

  it('shows a message and clears the token when verification cannot load or fails', async () => {
    const onToken = vi.fn();
    render(<TurnstileWidget siteKey="site-key" onToken={onToken} />);
    await vi.waitFor(() => expect(api.render).toHaveBeenCalled());
    api.render.mock.calls[0][1]['error-callback']();
    expect((await screen.findByRole('alert')).textContent).toMatch(/verification/i);
    expect(onToken).toHaveBeenLastCalledWith(null);
  });
});
