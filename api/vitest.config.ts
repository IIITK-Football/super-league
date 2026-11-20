import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// The Worker app runs in Node for tests: Hono and the shared handlers use only Web APIs. The "@" alias matches the
// backend's tsconfig paths, which the shared handlers import through. Test files share the local Supabase database, so
// they run one at a time (as in backend/vitest.config.ts).
export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, '../backend') } },
  test: { include: ['test/**/*.test.ts'], fileParallelism: false },
});
