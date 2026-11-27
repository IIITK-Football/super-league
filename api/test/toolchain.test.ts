// Group: api-services. The Worker's build configuration: handler imports written as "@/..." resolve to backend/, with
// options the current TypeScript still accepts.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const api = resolve(__dirname, '..');
const read = (file: string) => readFileSync(resolve(api, file), 'utf8').replace(/^\s*\/\/.*$/gm, '');

it('maps @/ to the backend folder without the removed baseUrl option', () => {
  const { compilerOptions } = JSON.parse(read('tsconfig.json'));
  expect(compilerOptions).not.toHaveProperty('baseUrl');
  const [target] = compilerOptions.paths['@/*'];
  expect(existsSync(resolve(api, target.replace('*', 'lib/scope.ts')))).toBe(true);
});
