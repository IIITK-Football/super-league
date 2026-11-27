// Group: api-services. The handlers the Worker serves are plain Web handlers: nothing in them, or in the shared code,
// depends on the retired Next.js runtime (its packages, route settings or app files).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { routes } from '../src/routes';

const backend = resolve(__dirname, '../../backend');
const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx|js)$/.test(name) ? [path] : [];
});

it('no handler or shared module uses Next.js', () => {
  const offenders = [...files(join(backend, 'app')), ...files(join(backend, 'lib'))]
    .filter((file) => /from ['"]next(\/|['"])|export const (dynamic|revalidate)\b|^['"]use client['"]/m.test(readFileSync(file, 'utf8')))
    .map((file) => relative(backend, file));
  expect(offenders).toEqual([]);
  for (const gone of ['middleware.ts', 'next.config.ts', 'app/layout.tsx']) expect(existsSync(join(backend, gone)), gone).toBe(false);
});

it('every handler file under app/api is mounted', async () => {
  const table = readFileSync(resolve(__dirname, '../src/routes.ts'), 'utf8');
  const unmounted = files(join(backend, 'app/api'))
    .map((file) => relative(backend, file).replace(/\.ts$/, ''))
    .filter((file) => file.endsWith('/route') && !table.includes(`../../backend/${file}'`));
  expect(unmounted).toEqual([]);
  await Promise.all(routes.map(([, load]) => load()));
});
