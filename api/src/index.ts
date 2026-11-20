// Worker entry. Configuration comes from the Worker's bindings, which nodejs_compat exposes as process.env, so the
// shared backend handlers read their settings the same way everywhere.
import { createApp } from './app';

const app = createApp();

export default {
  fetch: (request: Request, env: unknown, ctx: unknown) => app.fetch(request, env, ctx as never),
};
