// Group: tooling. The API Worker staging workflow deploys only staging, only from develop, refuses a production
// Supabase URL before deploying, and never prints or commits a secret.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const wf = readFileSync(join(__dirname, '../../../.github/workflows/worker-staging.yml'), 'utf8');

describe('worker staging workflow', () => {
  it('runs only for develop', () => {
    expect(wf).toMatch(/branches: \[develop\]/);
    expect(wf).not.toMatch(/branches: \[[^\]]*main/);
    expect(wf).toContain("if: github.ref == 'refs/heads/develop'");
  });

  it('deploys only the staging environment through the dedicated GitHub environment', () => {
    expect(wf).toContain('environment: Worker Preview');
    expect(wf).toContain('wrangler deploy --env staging');
    expect(wf).toContain('wrangler secret bulk "$f" --env staging');
    expect(wf.match(/wrangler deploy/g)).toHaveLength(1);
  });

  it('refuses the production project before deploying', () => {
    const guard = wf.indexOf('Refuse anything but the staging project');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(wf.indexOf('Deploy to staging'));
    expect(wf).toContain('PRODUCTION_PROJECT_REF');
  });

  it('never echoes secret values', () => {
    expect(wf).not.toMatch(/echo .*\$\{\{\s*secrets\./);
    expect(wf).not.toMatch(/echo "\$SUPABASE_(SECRET|PUBLISHABLE)/);
  });
});
