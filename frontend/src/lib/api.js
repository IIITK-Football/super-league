const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
const productionApiUrl = 'https://super-league-chi.vercel.app/api';

const isLoopbackUrl = (value) => {
  try {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(value).hostname);
  } catch {
    return false;
  }
};

const runningOnLoopback = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
const configuredLoopback = configuredApiUrl && isLoopbackUrl(configuredApiUrl);

// A phone opening the Vite dev server cannot reach its own localhost backend.
// Point it at the deployed API; on the developer's computer retain localhost.
const selectedApiUrl = configuredLoopback && !runningOnLoopback
  ? productionApiUrl
  : configuredApiUrl || productionApiUrl;

const parsedApiUrl = new URL(selectedApiUrl, window.location.origin);
if (configuredLoopback && runningOnLoopback && !parsedApiUrl.port) parsedApiUrl.port = '3000';
if (!parsedApiUrl.pathname.replace(/\/$/, '').endsWith('/api')) {
  parsedApiUrl.pathname = `${parsedApiUrl.pathname.replace(/\/$/, '')}/api`;
}

export const API_BASE_URL = parsedApiUrl.toString().replace(/\/$/, '');
