#!/usr/bin/env node
// R10 for division lifecycle. Runs the real Pages site and Worker locally, or an owner's staging pair.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localProblems, serverApi, start, stop, waitFor } from '../parity/lib.mjs';
import { loadEnvText, STAGING_REF, verifyTarget } from '../staging-checks.mjs';
import { accessHeaders, verifySite } from '../staging-media-check.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(join(root, 'frontend/package.json'))('playwright');
const frontend = join(root, 'frontend');
const api = join(root, 'api');
const target = process.argv[process.argv.indexOf('--target') + 1];
const local = target === 'local';
const processes = [];

function supabase() {
  if (!local) {
    const env = loadEnvText(readFileSync(join(root, 'backend/.env.staging.local'), 'utf8'));
    const site = (process.env.STAGING_SITE_URL || 'https://develop.super-league.pages.dev').replace(/\/+$/, '');
    const issues = [...verifyTarget(env), ...verifySite(site)];
    if (issues.length) throw new Error(issues.join('; '));
    return {
      site, access: accessHeaders(), storageKey: `sb-${STAGING_REF}-auth-token`,
      db: serverApi({ url: `https://${STAGING_REF}.supabase.co`, secretKey: env.SUPABASE_SECRET_KEY, publishableKey: env.SUPABASE_PUBLISHABLE_KEY }),
    };
  }
  const status = spawnSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], { cwd: join(root, 'backend'), encoding: 'utf8' });
  if (status.status !== 0) throw new Error('Local Supabase must be running.');
  const keys = JSON.parse(status.stdout.slice(status.stdout.indexOf('{')));
  const problems = localProblems(keys, readFileSync(join(api, '.dev.vars'), 'utf8'));
  if (problems.length) throw new Error(problems.join('; '));
  return {
    keys, site: 'http://127.0.0.1:8790', access: {}, storageKey: 'sb-127-auth-token',
    db: serverApi({ url: keys.API_URL, secretKey: keys.SECRET_KEY, publishableKey: keys.PUBLISHABLE_KEY }),
  };
}

async function serve(keys) {
  for (const port of [8787, 8790]) {
    if (await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false)) {
      throw new Error(`Port ${port} is already serving.`);
    }
  }
  const build = spawnSync(join(frontend, 'node_modules/.bin/vite'), ['build'], {
    cwd: frontend, encoding: 'utf8',
    env: { ...process.env, VITE_SUPABASE_URL: keys.API_URL, VITE_SUPABASE_PUBLISHABLE_KEY: keys.PUBLISHABLE_KEY, VITE_API_URL: '/api' },
  });
  if (build.status !== 0) throw new Error('Local frontend build failed.');
  const wrangler = join(api, 'node_modules/.bin/wrangler');
  const flags = ['--ip', '127.0.0.1', '--show-interactive-dev-session=false'];
  const worker = start('API Worker', wrangler, ['dev', '--port', '8787', ...flags], api);
  processes.push(worker);
  await waitFor('http://127.0.0.1:8787/api/health', worker);
  const pages = start('Pages site', wrangler, ['pages', 'dev', 'dist', '--port', '8790', '--service', 'API=super-league-api', ...flags], frontend);
  processes.push(pages);
  await waitFor('http://127.0.0.1:8790/version.json', pages);
}

async function main() {
  if (!['local', 'staging'].includes(target)) throw new Error('Use --target local or --target staging.');
  const { db, site, access, storageKey, keys } = supabase();
  const tag = `sl-check-division-${Date.now().toString(36)}`;
  const ids = [];
  const steps = [];
  let browser;
  try {
    if (local) await serve(keys);
    const version = await fetch(`${site}/version.json`, { headers: access }).then((r) => r.json());
    assert.match(version.commit, /^[a-f0-9]{7,40}$/);
    const dictator = await db.account(`${tag}-dictator@iiitkottayam.ac.in`);
    ids.push(dictator.id);
    const normal = await db.account(`${tag}-normal@iiitkottayam.ac.in`);
    ids.push(normal.id);
    await db.insert('user_roles', { user_id: dictator.id, role: 'dictator' });
    const existing = await db.select('divisions', 'select=id,slug,sort_order&order=sort_order,id');
    const sl = existing.find((row) => row.slug === 'super-league');
    assert.ok(sl, 'The seeded Super League division is available');

    browser = await chromium.launch();
    const pageErrors = [];
    const open = async (account) => {
      const context = await browser.newContext();
      if (local) {
        await context.route('**/*', (route) => {
          const url = new URL(route.request().url());
          if (url.origin === keys.API_URL || (url.origin === site && !url.pathname.startsWith('/api/media/'))) {
            return route.continue();
          }
          return route.abort();
        });
      } else if (Object.keys(access).length) {
        await context.route(`${site}/**`, (route) => route.continue({ headers: { ...route.request().headers(), ...access } }));
      }
      if (account) {
        await context.addInitScript(([key, session]) => localStorage.setItem(key, JSON.stringify(session)), [storageKey, account.session]);
      }
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      page.on('pageerror', (error) => pageErrors.push(error.message));
      return page;
    };
    const admin = await open(dictator);
    const visitor = await open();
    const go = (page, path) => page.goto(`${site}${path}`, { waitUntil: 'domcontentloaded' });
    const clickWrite = async (button, method, path) => {
      const responsePromise = admin.waitForResponse((r) => new URL(r.url()).pathname === `/api${path}` && r.request().method() === method);
      await button.click();
      const response = await responsePromise;
      assert.ok(response.ok(), `${method} ${path} answered ${response.status()}`);
      return (await response.json()).data;
    };

    await go(admin, '/dictator');
    await admin.getByRole('button', { name: 'Divisions & Seasons' }).click();
    const form = admin.getByRole('form', { name: 'New division' });
    await form.getByLabel('Division name').fill('Lifecycle walkthrough');
    await form.getByLabel('Slug').fill(tag);
    const division = await clickWrite(form.getByRole('button', { name: 'Add division' }), 'POST', '/admin/divisions');
    const divisionRow = admin.getByRole('list', { name: 'Divisions', exact: true }).getByRole('listitem').filter({ hasText: `/${tag}` });
    await divisionRow.getByText('Hidden', { exact: true }).waitFor();
    await go(visitor, `/${tag}`);
    await visitor.getByText('Division not found.').waitFor();
    await clickWrite(divisionRow.getByRole('button', { name: 'Publish' }), 'PATCH', `/admin/divisions/${division}`);
    await go(visitor, '/');
    await visitor.getByRole('button', { name: 'Open menu' }).click();
    await visitor.getByRole('button', { name: 'Lifecycle walkthrough', exact: true }).click();
    try {
      await visitor.waitForURL(`${site}/${tag}`);
      await visitor.getByText('No public seasons yet.').waitFor();
    } catch (error) {
      const body = await visitor.locator('body').innerText({ timeout: 1000 }).catch(() => '');
      throw new Error(`Published division did not show its empty state at ${new URL(visitor.url()).pathname}. ${body.slice(0, 240)} ${pageErrors.join('; ')}`, { cause: error });
    }

    async function addSeason(name, slug) {
      const form = admin.getByRole('form', { name: 'New season' });
      await form.getByLabel('Season name').fill(name);
      await form.getByLabel('Season slug').fill(slug);
      return clickWrite(form.getByRole('button', { name: 'Add season' }), 'POST', '/admin/seasons');
    }
    await divisionRow.getByRole('button', { name: 'Seasons', exact: true }).click();
    const one = await addSeason('Walkthrough First', 'first');
    const two = await addSeason('Walkthrough Second', 'second');
    const list = admin.getByRole('list', { name: 'Seasons', exact: true });
    const seasonRow = (slug) => list.getByRole('listitem').filter({ has: admin.getByRole('textbox', { name: `Name of season ${slug}`, exact: true }) });
    const patchSeason = (slug, id, label) => clickWrite(seasonRow(slug).getByRole('button', { name: label, exact: true }), 'PATCH', `/admin/seasons/${id}`);
    await seasonRow('first').getByText('Hidden', { exact: true }).waitFor();
    await patchSeason('first', one, 'Publish');
    await patchSeason('second', two, 'Publish');
    await clickWrite(seasonRow('first').getByRole('button', { name: 'Make current' }), 'POST', `/admin/seasons/${one}/current`);
    await clickWrite(seasonRow('second').getByRole('button', { name: 'Move Walkthrough Second up' }), 'PUT', '/admin/seasons/order');
    await go(visitor, `/${tag}/second`);
    await visitor.getByLabel('Season', { exact: true }).waitFor();
    assert.equal(await visitor.getByLabel('Season', { exact: true }).inputValue(), 'second');
    for (const suffix of ['one', 'two']) {
      if (suffix === 'one') {
        await admin.getByRole('list', { name: 'Divisions', exact: true }).getByRole('listitem')
          .filter({ hasText: '/super-league' }).getByRole('button', { name: 'Seasons', exact: true }).click();
      }
      await addSeason(`Existing division ${suffix}`, `${tag}-${suffix}`);
    }
    const existingRows = await db.select('seasons', `division_id=eq.${sl.id}&slug=like.${tag}*&select=visibility`);
    assert.deepEqual(existingRows, [{ visibility: 'hidden' }, { visibility: 'hidden' }]);
    await divisionRow.getByRole('button', { name: 'Seasons', exact: true }).click();
    steps.push({ scenario: 'create, publish, reorder and select', outcomes: ['Hidden defaults in new and existing divisions', 'Explicit season URL opens its season'] });

    await patchSeason('first', one, 'Hide');
    await go(visitor, `/${tag}`);
    await visitor.getByText('Choose a season').waitFor();
    let [stored] = await db.select('seasons', `id=eq.${one}&select=is_current,visibility,archived_at`);
    assert.deepEqual(stored, { is_current: false, visibility: 'hidden', archived_at: null });
    await patchSeason('first', one, 'Publish');
    await clickWrite(seasonRow('first').getByRole('button', { name: 'Make current' }), 'POST', `/admin/seasons/${one}/current`);
    await patchSeason('first', one, 'Archive');
    await patchSeason('first', one, 'Restore');
    [stored] = await db.select('seasons', `id=eq.${one}&select=is_current,visibility,archived_at`);
    assert.deepEqual(stored, { is_current: false, visibility: 'hidden', archived_at: null });
    await clickWrite(divisionRow.getByRole('button', { name: 'Hide', exact: true }), 'PATCH', `/admin/divisions/${division}`);
    await go(visitor, `/${tag}/second`);
    await visitor.getByText('Division not found.').waitFor();
    await clickWrite(divisionRow.getByRole('button', { name: 'Publish', exact: true }), 'PATCH', `/admin/divisions/${division}`);
    steps.push({ scenario: 'hide, archive and restore', outcomes: ['Hiding and archiving clear current', 'Restore is hidden', 'A hidden division suppresses its seasons'] });

    await seasonRow('second').getByRole('button', { name: 'Sections', exact: true }).click();
    await admin.getByLabel('Teams enabled').uncheck();
    await admin.getByLabel('Fixtures in navigation').uncheck();
    await admin.getByLabel('Rules label').fill('Competition rules');
    await clickWrite(admin.getByRole('button', { name: 'Save sections' }), 'PUT', `/admin/seasons/${two}/sections`);
    await go(visitor, `/${tag}/second`);
    await visitor.getByText('No Fixtures Currently Scheduled', { exact: true }).waitFor();
    await visitor.getByRole('button', { name: 'Open navigation' }).click();
    await visitor.getByRole('button', { name: 'COMPETITION RULES' }).waitFor();
    assert.equal(await visitor.getByRole('button', { name: 'FIXTURES', exact: true }).count(), 0);
    assert.equal(await visitor.getByRole('button', { name: 'TEAMS', exact: true }).count(), 0);
    const scope = `division=${tag}&season=second`;
    await go(visitor, `/teams?${scope}`);
    await visitor.getByText('This section is not available for this season.').waitFor();
    const teamApi = await visitor.request.get(`${site}/api/teams?${scope}`, { headers: access });
    const fixturesApi = await visitor.request.get(`${site}/api/schedule?${scope}`, { headers: access });
    assert.equal(teamApi.status(), 404);
    assert.equal(fixturesApi.status(), 200);
    await go(visitor, `/matches?${scope}`);
    await visitor.getByRole('heading', { name: 'Matches', exact: true }).waitFor();
    steps.push({ scenario: 'configure sections', outcomes: ['Edited label in navigation', 'Disabled Teams denied with 404', 'Nav-hidden Fixtures API remains available'] });

    const write = (account, method, path, body) => fetch(`${site}/api${path}`, {
      method, headers: { ...access, Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal((await write(normal, 'PATCH', `/admin/seasons/${two}`, { name: 'Denied' })).status, 403);
    assert.equal((await write(dictator, 'PATCH', `/admin/seasons/${two}`, { name: 'Invalid', starts_on: '2026-12-01', ends_on: '2026-11-01' })).status, 400);
    const [audit] = await db.select('audit_log', `table_name=eq.seasons&record_id=eq.${two}&select=actor_id&order=id.desc&limit=1`);
    assert.equal(audit.actor_id, dictator.id);
    const [unchanged] = await db.select('seasons', `id=eq.${two}&select=name`);
    assert.equal(unchanged.name, 'Walkthrough Second');
    steps.push({ scenario: 'validate and audit', outcomes: ['Normal user refused', 'Invalid update leaves the row unchanged', 'Dictator recorded as audit actor'] });
    assert.deepEqual(pageErrors, [], 'The browser reported no uncaught errors');
    console.log(JSON.stringify({ item: 'SL-040', target, servedCommit: version.commit, steps }, null, 2));
  } finally {
    try {
      if (browser) await browser.close();
      await db.remove('seasons', `slug=like.${tag}*`);
      const temporary = await db.select('divisions', `slug=eq.${tag}&select=id`);
      for (const { id } of temporary) {
        await db.remove('seasons', `division_id=eq.${id}`);
        await db.remove('divisions', `id=eq.${id}`);
      }
      for (const id of ids) await db.deleteUser(id);
    } finally {
      for (const process of processes.reverse()) await stop(process);
    }
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
