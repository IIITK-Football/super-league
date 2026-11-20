// Group: tooling. The staging API Worker has exactly one deploy path: Cloudflare Workers Builds running
// api/scripts/deploy-staging.mjs (docs/worker-staging.md). No GitHub workflow deploys a Worker, so two paths can never
// compete, and nothing in CI can reach the production Worker.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '../../..');
const workflows = readdirSync(join(root, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f));

describe('API Worker deploy path', () => {
  it('no GitHub workflow deploys or uploads a Worker', () => {
    for (const f of workflows) {
      const text = readFileSync(join(root, '.github/workflows', f), 'utf8');
      expect(text, f).not.toMatch(/wrangler\s+(deploy|versions\s+(upload|deploy)|secret)/);
      expect(text, f).not.toContain('deploy-staging.mjs');
    }
  });

  it('the documented Workers Builds deploy command is the staging-only script', () => {
    const doc = readFileSync(join(root, 'docs/worker-staging.md'), 'utf8');
    expect(doc).toContain('`node api/scripts/deploy-staging.mjs`');
    expect(doc).toMatch(/Builds for non-production branches \| \*\*Off\*\*/);
    expect(readFileSync(join(root, 'api/scripts/deploy-staging.mjs'), 'utf8')).toContain("'deploy', '--env', 'staging'");
  });
});
