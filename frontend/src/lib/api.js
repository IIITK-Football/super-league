const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();

// Never ship a local API target in a production bundle. Cloudflare previews use
// the same-origin /api proxy unless VITE_API_URL points at the deployed backend.
export const API_BASE_URL = configuredApiUrl && (import.meta.env.DEV || !/localhost|127\.0\.0\.1/i.test(configuredApiUrl))
  ? configuredApiUrl.replace(/\/$/, '')
  : '/api';
