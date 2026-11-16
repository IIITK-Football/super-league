// Group: auth-identity. The documented rollback script, applied inside a transaction that is
// ALWAYS rolled back, on the LOCAL database only (127.0.0.1:54322). Nothing is committed.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const rollbackPath = join(__dirname, '../../../docs/rollback/auth-college-domain-rollback.sql');

// The script carries its own BEGIN/COMMIT for production use; drop them so this test controls the
// transaction and can roll everything back.
const rollbackBody = readFileSync(rollbackPath, 'utf8')
  .split('\n')
  .filter((l) => !/^\s*(BEGIN|COMMIT);\s*$/.test(l))
  .join('\n');

function run(assertions: string) {
  const script = `BEGIN;\n${rollbackBody}\n${assertions}\nROLLBACK;\n`;
  return spawnSync('psql', [LOCAL_DB, '-v', 'ON_ERROR_STOP=1', '-q'], { input: script, encoding: 'utf8' });
}

describe('auth college-domain rollback script', () => {
  it('only touches what it says it touches', () => {
    expect(readFileSync(rollbackPath, 'utf8')).not.toMatch(/\b(DELETE|UPDATE|TRUNCATE|DROP TABLE)\b/i);
  });

  it('drops only the email-change guard and keeps the other triggers', () => {
    const r = run(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ensure_domain_lock_on_email_change') THEN
          RAISE EXCEPTION 'email-change guard still present'; END IF;
        IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass
              AND tgname IN ('ensure_domain_lock','on_auth_user_created','on_auth_user_role_created')) <> 3 THEN
          RAISE EXCEPTION 'a trigger that must be kept was removed'; END IF;
      END $$;`);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('restores the previous check and new users still get a profile and role', () => {
    const r = run(`
      DO $$ BEGIN
        IF pg_get_functiondef('public.enforce_college_domain()'::regprocedure) LIKE '%lower(%' THEN
          RAISE EXCEPTION 'new domain check still in place'; END IF;
        INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
          VALUES ('91000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'rollback@iiitkottayam.ac.in', '', now(), now());
        IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = '91000000-0000-4000-8000-000000000001') THEN
          RAISE EXCEPTION 'profile not created'; END IF;
        IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = '91000000-0000-4000-8000-000000000001' AND role = 'default') THEN
          RAISE EXCEPTION 'default role not created'; END IF;
        BEGIN
          INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
            VALUES ('91000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'outsider@gmail.com', '', now(), now());
          RAISE EXCEPTION 'non-college email was accepted';
        EXCEPTION WHEN raise_exception THEN
          IF SQLERRM LIKE 'non-college%' THEN RAISE; END IF;
        END;
      END $$;`);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('left the database unchanged afterwards (the test always rolls back)', () => {
    const r = spawnSync(
      'psql',
      [LOCAL_DB, '-Atc', "select (select count(*) from pg_trigger where tgname='ensure_domain_lock_on_email_change') || ',' || (select count(*) from auth.users where email like 'rollback@%')"],
      { encoding: 'utf8' },
    );
    expect(r.stdout.trim()).toBe('1,0');
  });
});
