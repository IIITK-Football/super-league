// Group: tooling. Guard rails for .github/workflows/db-deploy.yml: develop deploys to staging
// (with the synthetic seed), main deploys to production (never seeded), using separate
// GitHub Environments. Text-based on purpose (no YAML dependency); jobs are split by indentation.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const path = join(__dirname, '../../../.github/workflows/db-deploy.yml');
const text = existsSync(path) ? readFileSync(path, 'utf8') : '';

function jobs(source: string): Record<string, string> {
  const start = source.indexOf('\njobs:\n');
  if (start < 0) return {};
  const body = source.slice(start + '\njobs:\n'.length);
  const out: Record<string, string> = {};
  let current: string | null = null;
  for (const line of body.split('\n')) {
    const m = line.match(/^ {2}([a-z][\w-]*):\s*$/);
    if (m) {
      current = m[1];
      out[current] = '';
    } else if (current) {
      out[current] += `${line}\n`;
    }
  }
  return out;
}
const j = jobs(text);
const header = text.slice(0, text.indexOf('\njobs:\n') < 0 ? undefined : text.indexOf('\njobs:\n'));

describe('db-deploy workflow', () => {
  it('exists and defines verify, staging and production jobs', () => {
    expect(existsSync(path)).toBe(true);
    expect(Object.keys(j).sort()).toEqual(['production', 'staging', 'verify']);
  });

  it('triggers only on pushes to develop and main (and manual runs), never on pull requests', () => {
    expect(header).toMatch(/^\s{2}push:\s*\n\s{4}branches:\s*\[develop, main\]/m);
    expect(header).toMatch(/workflow_dispatch:/);
    expect(header).not.toMatch(/pull_request/);
  });

  it('is read-only by default and keeps secrets out of the workflow level', () => {
    expect(header).toMatch(/^permissions:\s*\n\s{2}contents: read\s*$/m);
    expect(header).not.toMatch(/write/);
    expect(header).not.toMatch(/secrets\./);
    expect(j.verify).not.toMatch(/secrets\./);
  });

  it('verify proves migrations on an empty local database before any hosted push', () => {
    expect(j.verify).toMatch(/--frozen-lockfile/);
    expect(j.verify).toMatch(/db:start/);
    expect(j.verify).toMatch(/test-groups\.mjs run database/);
    expect(j.verify).not.toMatch(/supabase link|db push|environment:/);
  });

  describe('staging', () => {
    const s = j.staging ?? '';
    it('runs only for develop, behind the staging environment and after verify', () => {
      expect(s).toMatch(/needs: verify/);
      expect(s).toMatch(/if:.*refs\/heads\/develop/);
      expect(s).toMatch(/environment: staging\b/);
      expect(s).not.toMatch(/refs\/heads\/main/);
    });

    it('applies the synthetic seed', () => {
      expect(s).toMatch(/db push[^\n]*--include-seed/);
    });

    it('refuses the production project and checks the linked ref', () => {
      expect(s).toMatch(/PRODUCTION_PROJECT_REF/);
      expect(s).toMatch(/!=/);
      expect(s).toMatch(/\.temp\/project-ref/);
    });

    it('uses only staging environment credentials', () => {
      expect(s).toMatch(/secrets\.SUPABASE_ACCESS_TOKEN/);
      expect(s).toMatch(/secrets\.SUPABASE_DB_PASSWORD/);
      expect(s).toMatch(/vars\.SUPABASE_PROJECT_REF/);
    });
  });

  describe('production', () => {
    const p = j.production ?? '';
    it('runs only for main, behind the production environment and after verify', () => {
      expect(p).toMatch(/needs: verify/);
      expect(p).toMatch(/if:.*refs\/heads\/main/);
      expect(p).toMatch(/environment: production\b/);
      expect(p).not.toMatch(/refs\/heads\/develop/);
    });

    it('is never seeded and never forces out-of-order or config changes', () => {
      expect(p).not.toMatch(/--include-seed/);
      expect(p).not.toMatch(/--include-all/);
      expect(p).not.toMatch(/config push/);
      expect(p).not.toMatch(/db reset|--db-url|--linked/);
    });

    it('checks the linked ref equals the production ref and previews before applying', () => {
      expect(p).toMatch(/vars\.PRODUCTION_PROJECT_REF/);
      expect(p).toMatch(/\.temp\/project-ref/);
      const dry = p.indexOf('db push --dry-run');
      const real = p.search(/db push(?! --dry-run)/);
      expect(dry).toBeGreaterThan(-1);
      expect(real).toBeGreaterThan(dry);
    });
  });

  it('serialises deploys per environment without cancelling a running one', () => {
    for (const name of ['staging', 'production']) {
      expect(j[name] ?? '').toMatch(new RegExp(`group: db-deploy-${name}`));
      expect(j[name] ?? '').toMatch(/cancel-in-progress: false/);
    }
  });

  it('never links without asserting the ref, and never prints secrets', () => {
    for (const name of ['staging', 'production']) {
      const job = j[name] ?? '';
      if (/supabase link/.test(job)) expect(job).toMatch(/project-ref/);
      expect(job).not.toMatch(/echo[^\n]*(PASSWORD|ACCESS_TOKEN)/);
    }
  });

  it('manual runs default to a dry run', () => {
    expect(header).toMatch(/dry_run:[\s\S]*default: true/);
  });
});
