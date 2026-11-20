// Runtime-neutral HTTP helpers. Route handlers use only the Web Request and Response types, so the same handler runs
// in the Hono Worker (the target backend) and, until it is retired, in Next.

// The API is always called with a Bearer token (useApi/fetchApi), never with cookies, so server clients read no
// cookies. Handlers that build an @supabase/ssr client pass this empty store.
export const noCookies = {
  getAll: (): { name: string; value: string }[] => [],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  set: (..._args: unknown[]): void => {},
};

export const json = (body: unknown, status = 200, headers?: HeadersInit): Response =>
  Response.json(body, { status, headers });
