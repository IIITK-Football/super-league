// Same-origin API: every /api/* request on the Pages site is forwarded to the API Worker through the `API` service
// binding (set on the Pages project per environment). The browser never sees another origin, so no CORS policy
// exists. No logic lives here; if the binding is missing the request fails clearly instead of reaching anything else.
export async function onRequest({ request, env }) {
  if (!env.API || typeof env.API.fetch !== 'function') {
    return Response.json({ success: false, message: 'The API is not configured for this site.' }, { status: 503 });
  }
  return env.API.fetch(request);
}
