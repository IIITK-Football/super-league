// Worker entry. Text settings come from the Worker's bindings, which nodejs_compat exposes as process.env; the R2
// bucket bindings are objects, so they are handed to the storage module on every request.
import { createApp, setRelease } from './app';
import { bindBuckets } from '../../backend/lib/storage';

const app = createApp();

export default {
  fetch: (request: Request, env: Record<string, unknown>, ctx: unknown) => {
    bindBuckets(env ?? {});
    setRelease(env?.CF_VERSION_METADATA as { id?: string; tag?: string } | undefined);
    return app.fetch(request, env, ctx as never);
  },
};
