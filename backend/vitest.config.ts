import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname) } }, // matches tsconfig "paths"
  // The integration tests share one local Supabase database (127.0.0.1:54322) and several count or change seeded rows
  // (team entries, accounts, match events). Run test files one at a time so they never see each other's fixtures;
  // tests inside a file still run in order as before.
  test: { fileParallelism: false },
});
