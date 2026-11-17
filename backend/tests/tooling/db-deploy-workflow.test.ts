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

  it('verify also proves a seed rerun adds no duplicates and passes the Preview checks, on the local database only', () => {
    expect(j.verify).toMatch(/seed\.sql/);
    expect(j.verify).toMatch(/verify-preview\.sql/);
    expect(j.verify).toMatch(/127\.0\.0\.1:54322/);
    expect(j.verify).not.toMatch(/PREVIEW_|SUPABASE_DB_PASSWORD|secrets\./);
  });

  it('runs when the seed, the Preview scripts or the checks change', () => {
    for (const p of ['backend/supabase/seed.sql', 'scripts/preview-seed.sh', 'scripts/sql/verify-preview.sql']) {
      expect(header, p).toContain(p);
    }
  });

  describe('staging', () => {
    const s = j.staging ?? '';
    it('runs only for develop, behind the Database Preview environment and after verify', () => {
      expect(s).toMatch(/needs: verify/);
      expect(s).toMatch(/if:.*refs\/heads\/develop/);
      expect(s).toMatch(/^\s*environment: Database Preview\s*$/m);
      expect(s).not.toMatch(/refs\/heads\/main/);
    });

    it('pushes migrations only, then seeds and verifies through the guarded script, in that order', () => {
      expect(s).not.toMatch(/--include-seed/); // one seeding mechanism, with guards and a report
      const dryRun = s.indexOf('db push --dry-run');
      const push = s.search(/pnpm exec supabase db push\s*$/m);
      const seed = s.indexOf('scripts/preview-seed.sh seed');
      const verify = s.indexOf('scripts/preview-seed.sh verify');
      expect(dryRun).toBeGreaterThan(-1);
      expect(push).toBeGreaterThan(dryRun);
      expect(seed).toBeGreaterThan(push);
      expect(verify).toBeGreaterThan(seed);
    });

    it('seeds and verifies only when migrations are applied for real, never on a dry run', () => {
      for (const marker of ['scripts/preview-seed.sh seed', 'scripts/preview-seed.sh verify']) {
        const step = s.slice(s.lastIndexOf('- name:', s.indexOf(marker)), s.indexOf(marker));
        expect(step, marker).toMatch(/if: github\.event_name == 'push' \|\| inputs\.dry_run == false/);
      }
    });

    it('gives the seed script only the staging environment values it needs', () => {
      const step = s.slice(s.lastIndexOf('- name:', s.indexOf('scripts/preview-seed.sh seed')));
      expect(s).toMatch(/SUPABASE_DB_PASSWORD: \$\{\{ secrets\.SUPABASE_DB_PASSWORD \}\}/);
      expect(step).not.toMatch(/--password|PGPASSWORD=|set -x/);
    });

    it('reports the seed and verification in the job summary', () => {
      expect(readFileSync(join(__dirname, '../../../scripts/preview-seed.sh'), 'utf8')).toMatch(/GITHUB_STEP_SUMMARY/);
    });

    it('probes the public API only when the staging publishable key is configured, and says so when skipped', () => {
      expect(s).toMatch(/PREVIEW_PUBLISHABLE_KEY/);
      expect(s).toMatch(/verify-rpc-closed\.mjs/);
      expect(s).toMatch(/skipped/i);
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
    it('runs only for main, behind the Database Production environment and after verify', () => {
      expect(p).toMatch(/needs: verify/);
      expect(p).toMatch(/if:.*refs\/heads\/main/);
      expect(p).toMatch(/^\s*environment: Database Production\s*$/m);
      expect(p).not.toMatch(/refs\/heads\/develop/);
    });

    it('refuses to replay the baseline: production has no migration history yet, so the baseline must be marked applied, never run', () => {
      // the guard reads the dry-run output and must come before the real push
      const guard = p.search(/20261106000000/);
      const real = p.search(/db push(?! --dry-run)/);
      expect(guard).toBeGreaterThan(-1);
      expect(real).toBeGreaterThan(guard);
      expect(p).toMatch(/grep[^\n]*20261106000000[^\n]*dry-run\.txt/);
      expect(p).toMatch(/exit 1/);
      expect(p).toMatch(/docs\/release\.md/);
    });

    it('applies only when the guard step has passed (it is an earlier step of the same job)', () => {
      const guardStep = p.indexOf('Refuse to replay the baseline');
      const applyStep = p.indexOf('Apply migrations');
      expect(guardStep).toBeGreaterThan(-1);
      expect(applyStep).toBeGreaterThan(guardStep);
    });

    it('is never seeded and never forces out-of-order or config changes', () => {
      expect(p).not.toMatch(/--include-seed/);
      expect(p).not.toMatch(/preview-seed|seed\.sql|verify-preview|PREVIEW_|psql/);
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

  it('uses dedicated database environments and never the ones the Vercel integration owns', () => {
    const names = [...text.matchAll(/^\s*environment:\s*(.+?)\s*$/gm)].map((m) => m[1]);
    expect(names.sort()).toEqual(['Database Preview', 'Database Production']);
    // `Preview` and `Production` belong to the Vercel integration; `staging` was never created.
    for (const forbidden of ['Preview', 'Production', 'preview', 'production', 'staging']) {
      expect(names).not.toContain(forbidden);
    }
  });
});
