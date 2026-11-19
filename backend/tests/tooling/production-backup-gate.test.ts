// Group: tooling. The production backup gate (docs/backups.md):
// * db-deploy.yml: the production migration job needs the production-backup job (so a failed backup means no approval
//   request and no migration), confirms the backup before it links to production or pushes migrations, and has no
//   input, variable or continue-on-error that skips it; nothing is uploaded as an Actions artifact (public repository);
// * scripts/backup/database-backup.sh refuses wrong targets, projects, buckets and keys before contacting anything;
// * scripts/backup/confirm-backup.sh permits only an intact, recent, restore-tested production pre-migration backup.
// Runs locally with a temporary directory standing in for R2; nothing remote is contacted.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '../../..');
const deploy = readFileSync(join(root, '.github/workflows/db-deploy.yml'), 'utf8');
const backupWorkflow = readFileSync(join(root, '.github/workflows/db-backup.yml'), 'utf8');
const action = readFileSync(join(root, '.github/actions/database-backup/action.yml'), 'utf8');
const PROD = 'obkxfepdpdufxawhzaen';
const STAGING = 'yecozsiccsfwphlmxozt';
const RECIPIENT = `age1${'q'.repeat(58)}`;

// A top-level job's block: from "  <name>:" to the next top-level job.
const job = (yml: string, name: string) => {
  const start = yml.indexOf(`\n  ${name}:\n`);
  expect(start, name).toBeGreaterThan(0);
  const rest = yml.slice(start + 1);
  const next = rest.slice(3).search(/\n {2}[a-z][a-z0-9-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 3);
};

describe('the backup gate in db-deploy.yml', () => {
  const backupJob = job(deploy, 'production-backup');
  const prodJob = job(deploy, 'production');

  it('the production migration job cannot start, or ask for approval, without the backup job succeeding', () => {
    expect(prodJob).toMatch(/\n {4}needs: \[verify, production-backup\]\n/);
    expect(prodJob).toMatch(/environment: Database Production/);
    expect(backupJob).toMatch(/environment: Database Backup/);
    expect(backupJob).toMatch(/if: github\.ref == 'refs\/heads\/main'/);
    expect(backupJob).toMatch(/uses: \.\/\.github\/actions\/database-backup/);
    expect(backupJob).toMatch(/target: production\n\s+reason: pre-migration/);
    expect(backupJob).toMatch(/db-url: \$\{\{ secrets\.PRODUCTION_BACKUP_DB_URL \}\}/);
  });

  it('confirms the backup before it links to production or pushes migrations', () => {
    const confirm = prodJob.indexOf('name: Confirm the pre-migration backup');
    expect(confirm).toBeGreaterThan(0);
    expect(confirm).toBeLessThan(prodJob.indexOf('name: Link to the production project'));
    expect(confirm).toBeLessThan(prodJob.indexOf('supabase db push'));
    expect(prodJob).toMatch(/BACKUP_KEY: \$\{\{ needs\.production-backup\.outputs\.key \}\}/);
    expect(prodJob).toMatch(/MAX_AGE_HOURS: '6'/);
  });

  it('has no way to skip the backup, and never uploads artifacts', () => {
    for (const [name, text] of [['db-deploy.yml', deploy], ['db-backup.yml', backupWorkflow], ['action.yml', action]]) {
      expect(text, name).not.toMatch(/continue-on-error/);
      expect(text, name).not.toMatch(/upload-artifact/);
      expect(text, name).not.toMatch(/skip[_-]?backup/i);
    }
    expect(backupJob).not.toMatch(/\n {4}if: .*inputs\./);
  });

  it('the scheduled and on-demand workflow backs up production daily and rehearses only on staging', () => {
    expect(backupWorkflow).toMatch(/cron: '30 21 \* \* \*'/);
    expect(backupWorkflow).toMatch(/environment: Database Backup/);
    expect(backupWorkflow).toMatch(/Production backups run only from main; refusing to continue/);
    expect(backupWorkflow).toMatch(/if \[ "\$EVENT" = push \]; then target=staging; reason=rehearsal/);
  });
});

function runBackup(env: Record<string, string>) {
  return spawnSync('bash', [join(root, 'scripts/backup/database-backup.sh')], {
    encoding: 'utf8', env: { PATH: process.env.PATH!, HOME: process.env.HOME!, ...env } as NodeJS.ProcessEnv,
  });
}
const base = (over: Record<string, string> = {}) => ({
  TARGET: 'production', REASON: 'pre-migration', PRODUCTION_REF: PROD, EXPECTED_REF: PROD,
  DB_URL: `postgresql://backup_reader.${PROD}:pw@aws-0-x.pooler.supabase.com:5432/postgres`, AGE_RECIPIENT: RECIPIENT,
  R2_BUCKET: 'backup', R2_ENDPOINT: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`, AWS_ACCESS_KEY_ID: 'k', AWS_SECRET_ACCESS_KEY: 's',
  // Points nowhere: every case below must stop at the guards, before any connection.
  PGCONNECT_TIMEOUT: '1', ...over,
});

describe('database-backup.sh guards (before anything is contacted)', () => {
  const cases: [string, Record<string, string>, RegExp][] = [
    ['a staging rehearsal with the production URL', { TARGET: 'staging', REASON: 'rehearsal', EXPECTED_REF: STAGING }, /names a different project/],
    ['a staging rehearsal aimed at production', { TARGET: 'staging', REASON: 'rehearsal' }, /rehearsal must target the staging project/],
    ['production with the staging URL', { DB_URL: `postgresql://backup_reader.${STAGING}:pw@h:5432/postgres` }, /names a different project/],
    ['a production rehearsal', { REASON: 'rehearsal' }, /a rehearsal never targets production/],
    ['a scheduled staging backup', { TARGET: 'staging', REASON: 'scheduled', EXPECTED_REF: STAGING }, /staging is only the rehearsal target/],
    ['the wrong bucket', { R2_BUCKET: 'screenshot' }, /R2_BUCKET is not the backup bucket/],
    ['a non-R2 endpoint', { R2_ENDPOINT: 'https://s3.amazonaws.com' }, /not an R2 S3 endpoint/],
    ['a bad age key', { AGE_RECIPIENT: 'ssh-ed25519 AAAA' }, /not an age public key/],
    ['a direct (non-pooler) URL', { DB_URL: 'postgresql://postgres:pw@db.x.supabase.co:5432/postgres' }, /not a Session pooler URI/],
  ];
  for (const [label, over, message] of cases) {
    it(`refuses ${label}`, () => {
      const r = runBackup(base(over));
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(message);
      expect(r.stdout + r.stderr).not.toMatch(/:pw@/); // never prints the URL
      // Only a pre-migration backup carries the migration verdict.
      if ((over.REASON ?? 'pre-migration') === 'pre-migration') expect(r.stdout).toMatch(/Production migration permitted: no/);
      else expect(r.stdout).not.toMatch(/Production migration permitted/);
    });
  }
});

describe('confirm-backup.sh', () => {
  const KEY = 'automated-prod/pre-migration/20261120T010203Z-123-1.dump.age';
  function store(manifest: Record<string, unknown>, body = 'encrypted-backup') {
    const dir = mkdtempSync(join(tmpdir(), 'confirm-'));
    const sha = createHash('sha256').update(body).digest('hex');
    mkdirSync(join(dir, dirname(KEY)), { recursive: true });
    writeFileSync(join(dir, KEY), body);
    writeFileSync(join(dir, KEY.replace(/\.dump\.age$/, '.manifest.json')), JSON.stringify({
      target: 'production', reason: 'pre-migration', sha256: sha, restore_test_passed: true, created_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), ...manifest,
    }));
    return { dir, sha };
  }
  const confirm = (env: Record<string, string>) => spawnSync('bash', [join(root, 'scripts/backup/confirm-backup.sh')], {
    encoding: 'utf8', env: { PATH: process.env.PATH!, HOME: process.env.HOME!, BACKUP_KEY: KEY, MAX_AGE_HOURS: '6', ...env } as NodeJS.ProcessEnv,
  });

  it('permits an intact, recent, restore-tested production pre-migration backup', () => {
    const { dir, sha } = store({});
    const r = confirm({ BACKUP_STORE_DIR: dir, BACKUP_SHA256: sha });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/Production migration permitted: yes \(verified: sha256 matches/);
  });

  const refusals: [string, () => Record<string, string>, RegExp][] = [
    ['no backup from the backup job', () => ({ BACKUP_KEY: '', BACKUP_SHA256: 'a'.repeat(64) }), /no pre-migration backup key/],
    ['a missing object', () => ({ BACKUP_STORE_DIR: mkdtempSync(join(tmpdir(), 'empty-')), BACKUP_SHA256: 'a'.repeat(64) }), /not in the bucket/],
    ['a changed object', () => { const s = store({}); return { BACKUP_STORE_DIR: s.dir, BACKUP_SHA256: 'b'.repeat(64) }; }, /does not match the checksum/],
    ['a stale backup', () => { const s = store({ created_at: '2026-11-19T00:00:00Z' }); return { BACKUP_STORE_DIR: s.dir, BACKUP_SHA256: s.sha }; }, /hours old \(limit 6\)/],
    ['a staging backup', () => { const s = store({ target: 'staging' }); return { BACKUP_STORE_DIR: s.dir, BACKUP_SHA256: s.sha }; }, /not of the production database/],
    ['a failed restore test', () => { const s = store({ restore_test_passed: false }); return { BACKUP_STORE_DIR: s.dir, BACKUP_SHA256: s.sha }; }, /did not pass its restore test/],
    ['a scheduled backup', () => { const s = store({ reason: 'scheduled' }); return { BACKUP_STORE_DIR: s.dir, BACKUP_SHA256: s.sha }; }, /not a pre-migration backup/],
  ];
  for (const [label, env, message] of refusals) {
    it(`refuses ${label}`, () => {
      const r = confirm(env());
      expect(r.status).not.toBe(0);
      expect(r.stdout).toMatch(/Production migration permitted: no/);
      expect(r.stdout).toMatch(message);
    });
  }
});
