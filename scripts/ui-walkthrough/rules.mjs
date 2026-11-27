#!/usr/bin/env node
// R10 for versioned rules. Runs the real Pages site and Worker locally, or the staging pair. Published rules cannot be
// deleted, so every run reuses one tagged division and leaves it hidden; on the local stack its history is removed too.
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
  const tag = `sl-check-rules-${Date.now().toString(36)}`;
  const slug = 'sl-check-rules';
  const ids = [];
  const steps = [];
  let browser;
  let divisionId;
  try {
    if (local) await serve(keys);
    const version = await fetch(`${site}/version.json`, { headers: access }).then((r) => r.json());
    assert.match(version.commit, /^[a-f0-9]{7,40}$/);
    const dictator = await db.account(`${tag}-dictator@iiitkottayam.ac.in`);
    ids.push(dictator.id);
    const normal = await db.account(`${tag}-normal@iiitkottayam.ac.in`);
    ids.push(normal.id);
    await db.insert('user_roles', { user_id: dictator.id, role: 'dictator' });

    // The fixture: a public test division with one new, empty season.
    const as = db.as(dictator.token);
    const rpc = async (name, body) => {
      const res = await as(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(body) });
      assert.ok(res.status < 300, `${name} answered ${res.status}`);
      return res.data;
    };
    const [existing] = await db.select('divisions', `slug=eq.${slug}&select=id`);
    divisionId = existing?.id ?? await rpc('create_division', { p_fields: { slug, name: 'Rules walkthrough' } });
    await rpc('update_division', { p_division: divisionId, p_fields: { archived: false } });
    await rpc('update_division', { p_division: divisionId, p_fields: { visibility: 'public' } });
    const seasonName = `Rules ${tag.slice(-6)}`;
    const season = await rpc('create_season', { p_division: divisionId, p_slug: tag, p_name: seasonName, p_starts_on: null, p_ends_on: null, p_format: 'league' });
    await rpc('update_season', { p_season: season, p_fields: { visibility: 'public' } });

    browser = await chromium.launch();
    const pageErrors = [];
    const open = async (account) => {
      const context = await browser.newContext();
      if (local) {
        await context.route('**/*', (route) => {
          const url = new URL(route.request().url());
          if (url.origin === keys.API_URL || (url.origin === site && !url.pathname.startsWith('/api/media/'))) return route.continue();
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
      page.on('dialog', (dialog) => dialog.accept());
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
    const text = (value) => visitor.getByText(value, { exact: true });

    // 1. Migrated rules read as before.
    for (const [division, heading] of [['super-league', 'League Format & Objective'], ['wsl', 'Team & Match Format']]) {
      await go(visitor, `/rules?division=${division}`);
      await visitor.getByRole('heading', { name: heading, exact: true }).waitFor();
    }
    steps.push({ scenario: 'migrated rules', outcomes: ['Super League and WSL rules are readable from their published versions'] });

    // 2. Build, reorder, hide and preview.
    await go(visitor, `/rules?division=${slug}&season=${tag}`);
    await text('Rules have not been published for this season yet.').waitFor();
    await go(admin, '/dictator');
    await admin.getByRole('button', { name: 'Divisions & Seasons' }).click();
    await admin.getByRole('list', { name: 'Divisions', exact: true }).getByRole('listitem').filter({ hasText: `/${slug}` })
      .getByRole('button', { name: 'Seasons', exact: true }).click();
    const seasonRow = admin.getByRole('list', { name: 'Seasons', exact: true }).getByRole('listitem')
      .filter({ has: admin.getByRole('textbox', { name: `Name of season ${tag}`, exact: true }) });
    await seasonRow.getByRole('button', { name: 'Rules', exact: true }).click();
    const rules = admin.getByRole('region', { name: `Rules of ${seasonName}` });
    await rules.getByText('No rules yet').waitFor();
    const editor = rules.getByRole('group', { name: 'Block editor' });
    const add = async (type) => {
      await rules.getByLabel('New block type').selectOption(type);
      await rules.getByRole('button', { name: 'Add block' }).click();
    };
    await add('section');
    await editor.getByLabel('Title').fill('Walkthrough format');
    await editor.getByLabel('Points (one per line)').fill('Halves: Two of twenty minutes\nSubstitutes: Three');
    await add('callout');
    await editor.getByLabel('Title').fill('Who may play');
    await editor.getByLabel('Text').fill('Enrolled students only');
    await add('steps');
    await editor.getByLabel('Steps (one per line)').fill('Register\nAttend');
    await add('table');
    await editor.getByLabel('Column 1 heading').fill('Result');
    await editor.getByLabel('Column 2 heading').fill('Points');
    await editor.getByLabel('Row 1, column 1').fill('Win');
    await editor.getByLabel('Row 1, column 2').fill('Three');
    await add('notice');
    await editor.getByLabel('Text').fill('Hidden for now');
    await rules.getByRole('button', { name: 'Hide block 5' }).click();
    await rules.getByRole('button', { name: 'Move block 2 up' }).click();
    await rules.getByRole('button', { name: 'Preview' }).click();
    const preview = rules.getByRole('region', { name: 'Preview' });
    await preview.getByText('Preview — not published').waitFor();
    await preview.getByRole('table').waitFor();
    assert.equal(await preview.getByText('Hidden for now').count(), 0);
    const base = `/admin/seasons/${season}/rules`;
    await clickWrite(rules.getByRole('button', { name: 'Save draft' }), 'PUT', `${base}/draft`);
    await rules.getByText('Draft saved, not published').waitFor();
    await go(visitor, `/rules?division=${slug}&season=${tag}`);
    await text('Rules have not been published for this season yet.').waitFor();
    steps.push({ scenario: 'build and preview', outcomes: ['Five block types assembled, reordered and one hidden', 'Preview leaves the hidden block out', 'Saving a draft publishes nothing'] });

    // 3. Publish, edit a new draft, publish again, read the old version.
    assert.deepEqual(await clickWrite(rules.getByRole('button', { name: 'Publish' }), 'POST', `${base}/publish`), { version: 1 });
    await rules.getByText('Matches version 1').waitFor();
    await go(visitor, `/rules?division=${slug}&season=${tag}`);
    await visitor.getByRole('heading', { name: 'Walkthrough format' }).waitFor();
    const headings = await visitor.getByRole('heading', { level: 2 }).allInnerTexts();
    assert.deepEqual(headings.slice(0, 2).map((h) => h.toLowerCase()), ['who may play', 'walkthrough format']);
    assert.equal(await text('Hidden for now').count(), 0);
    await rules.getByRole('list', { name: 'Blocks' }).getByText('Who may play').click();
    await editor.getByLabel('Text').fill('Students and alumni');
    await clickWrite(rules.getByRole('button', { name: 'Save draft' }), 'PUT', `${base}/draft`);
    await rules.getByText('Unpublished changes').waitFor();
    await go(visitor, `/rules?division=${slug}&season=${tag}`);
    await text('Enrolled students only').waitFor();
    assert.equal(await text('Students and alumni').count(), 0);
    await clickWrite(rules.getByRole('button', { name: 'Publish' }), 'POST', `${base}/publish`);
    await rules.getByText('Matches version 2').waitFor();
    await go(visitor, `/rules?division=${slug}&season=${tag}`);
    await text('Students and alumni').waitFor().catch(async (error) => {
      const body = await visitor.locator('body').innerText({ timeout: 1000 }).catch(() => '');
      const answer = await visitor.request.get(`${site}/api/rules?division=${slug}&season=${tag}`, { headers: access }).then((r) => r.text());
      throw new Error(`Version 2 did not show. Page: ${body.slice(0, 500)} API: ${answer.slice(0, 600)}`, { cause: error });
    });
    await rules.getByRole('button', { name: 'View version 1' }).click();
    await rules.getByRole('region', { name: 'Version 1' }).getByText('Enrolled students only').waitFor();
    const stored = await db.select('season_rules_versions', `season_id=eq.${season}&select=version,blocks&order=version`);
    assert.deepEqual(stored.map((v) => [v.version, v.blocks.length]), [[1, 4], [2, 4]]);
    const audit = await db.select('audit_log', `table_name=eq.season_rules_versions&record_id=like.${season}*&select=actor_id`);
    assert.deepEqual(audit, [{ actor_id: dictator.id }, { actor_id: dictator.id }]);
    steps.push({ scenario: 'publish and history', outcomes: ['Version 1 published, in the chosen order', 'A new draft changes nothing public', 'Version 2 public, version 1 unchanged and readable', 'Both publishes audited with the dictator'] });

    // 4. Everyone else is refused.
    const api = (token, method, path, body) => fetch(`${site}/api${path}`, {
      method, headers: { ...access, ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const [method, path, body] of [['GET', base], ['GET', `${base}/versions/1`], ['PUT', `${base}/draft`, { blocks: [] }], ['POST', `${base}/publish`]]) {
      assert.equal((await api(normal.token, method, path, body)).status, 403, `normal ${method} ${path}`);
      assert.equal((await api(null, method, path, body)).status, 401, `visitor ${method} ${path}`);
    }
    for (const table of ['season_rules_drafts', 'season_rules_versions']) {
      const read = await db.as(normal.token)(`/rest/v1/${table}?season_id=eq.${season}&select=season_id`);
      assert.deepEqual(read.data, []);
    }
    const [draft] = await db.select('season_rules_drafts', `season_id=eq.${season}&select=blocks`);
    assert.equal(draft.blocks.length, 5);
    steps.push({ scenario: 'refusals', outcomes: ['Normal user and visitor refused on every management route', 'Drafts and history unreadable through the Data API', 'Stored draft unchanged'] });
    assert.deepEqual(pageErrors, [], 'The browser reported no uncaught errors');
    console.log(JSON.stringify({ item: 'SL-044', target, servedCommit: version.commit, steps }, null, 2));
  } finally {
    try {
      if (browser) await browser.close();
      if (divisionId && local) {
        // Local only: published versions are immutable for every role, so the fixture is removed with triggers off.
        spawnSync('psql', ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-c',
          `SET session_replication_role = replica;
           DELETE FROM public.season_rules_versions WHERE season_id IN (SELECT id FROM public.seasons WHERE division_id = '${divisionId}');
           DELETE FROM public.season_rules_drafts WHERE season_id IN (SELECT id FROM public.seasons WHERE division_id = '${divisionId}');
           DELETE FROM public.season_sections WHERE season_id IN (SELECT id FROM public.seasons WHERE division_id = '${divisionId}');
           DELETE FROM public.seasons WHERE division_id = '${divisionId}';
           DELETE FROM public.divisions WHERE id = '${divisionId}';`]);
      } else if (divisionId && ids[0]) {
        const owner = await db.account(`${tag}-cleanup@iiitkottayam.ac.in`);
        ids.push(owner.id);
        await db.insert('user_roles', { user_id: owner.id, role: 'dictator' });
        await db.as(owner.token)('/rest/v1/rpc/update_division', { method: 'POST', body: JSON.stringify({ p_division: divisionId, p_fields: { archived: true } }) });
      }
      for (const id of ids) await db.deleteUser(id);
    } finally {
      for (const process of processes.reverse()) await stop(process);
    }
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
