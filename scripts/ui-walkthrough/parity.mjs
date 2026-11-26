#!/usr/bin/env node
// SL-032 browser walkthrough (R10): drives the REAL site with Chromium through every active contract group, as the
// real callers, down to the stored result. Every /api request the pages make is recorded (path and status), and a
// step fails on a server error, an uncaught page error, or a missing stored result.
//
//   node scripts/ui-walkthrough/parity.mjs --target local [screenshot-dir]    builds the site against the local stack
//                                                                            and serves it with wrangler pages dev
//                                                                            bound to wrangler dev
//   node scripts/ui-walkthrough/parity.mjs --target staging [screenshot-dir]  https://develop.super-league.pages.dev,
//                                                                            Access headers on the site origin only
//
// Fixtures are the parity runner's (scripts/parity/lib.mjs), tagged and removed at the end. Prints one JSON evidence
// document to standard output.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupFixtures, createFixtures, localProblems, png, serverApi, start, stop, waitFor } from '../parity/lib.mjs';
import { loadEnvText, STAGING_REF, verifyTarget } from '../staging-checks.mjs';
import { accessHeaders, verifySite } from '../staging-media-check.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(join(REPO, 'frontend/package.json'))('playwright');
const log = (line) => process.stderr.write(`${line}\n`);
const targetName = process.argv[process.argv.indexOf('--target') + 1];
const shots = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && a !== targetName) ?? join(REPO, '..', `sl-parity-shots-${targetName}`);

async function localTarget() {
  const r = spawnSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], { encoding: 'utf8', cwd: join(REPO, 'backend') });
  if (r.status !== 0) throw new Error('local Supabase is not running (pnpm db:start).');
  const status = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  const problems = localProblems(status, readFileSync(join(REPO, 'api/.dev.vars'), 'utf8'));
  if (problems.length) throw new Error(problems.join('; '));
  for (const port of [8787, 8790]) {
    if (await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false)) throw new Error(`port ${port} is already serving`);
  }
  log('building the frontend against the local stack');
  const env = { ...process.env, VITE_SUPABASE_URL: status.API_URL, VITE_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY };
  const build = spawnSync(join(REPO, 'frontend/node_modules/.bin/vite'), ['build'], { cwd: join(REPO, 'frontend'), encoding: 'utf8', env });
  if (build.status !== 0) throw new Error(`frontend build failed:\n${build.stderr.slice(-1500)}`);
  const bundle = readdirSync(join(REPO, 'frontend/dist/assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(REPO, 'frontend/dist/assets', f), 'utf8')).join('');
  if (!bundle.includes('127.0.0.1:54321') || /[a-z]{20}\.supabase\.co/.test(bundle)) throw new Error('the local build does not point only at the local stack');
  const wrangler = join(REPO, 'api/node_modules/.bin/wrangler');
  const worker = start('the API Worker', wrangler, ['dev', '--port', '8787', '--ip', '127.0.0.1', '--show-interactive-dev-session=false'], join(REPO, 'api'));
  await waitFor('http://127.0.0.1:8787/api/health', worker);
  const pages = start('the Pages site', wrangler, ['pages', 'dev', 'dist', '--port', '8790', '--ip', '127.0.0.1', '--service', 'API=super-league-api', '--show-interactive-dev-session=false'], join(REPO, 'frontend'));
  await waitFor('http://127.0.0.1:8790/version.json', pages);
  return {
    name: 'local', site: 'http://127.0.0.1:8790', access: null, storageKey: 'sb-127-auth-token',
    db: serverApi({ url: status.API_URL, secretKey: status.SECRET_KEY, publishableKey: status.PUBLISHABLE_KEY }),
    close: async () => { await stop(pages); await stop(worker); },
  };
}

async function stagingTarget() {
  const envFile = join(REPO, 'backend/.env.staging.local');
  if (!existsSync(envFile)) throw new Error('backend/.env.staging.local is missing');
  const env = loadEnvText(readFileSync(envFile, 'utf8'));
  const site = (process.env.STAGING_SITE_URL || 'https://develop.super-league.pages.dev').replace(/\/+$/, '');
  const problems = [...verifyTarget(env), ...verifySite(site)];
  if (problems.length) throw new Error(`refusing to run: ${problems.join('; ')}`);
  return {
    name: 'staging', site, access: accessHeaders(), storageKey: `sb-${STAGING_REF}-auth-token`,
    db: serverApi({ url: `https://${STAGING_REF}.supabase.co`, secretKey: env.SUPABASE_SECRET_KEY, publishableKey: env.SUPABASE_PUBLISHABLE_KEY }),
    close: async () => {},
  };
}

async function main() {
  if (!['local', 'staging'].includes(targetName)) throw new Error('use --target local or --target staging');
  mkdirSync(shots, { recursive: true });
  const target = targetName === 'local' ? await localTarget() : await stagingTarget();
  const { db } = target;
  const tag = `uip${Date.now().toString(36)}`;
  const made = { users: [], teams: [], entries: [], players: [], matches: [], news: [] };
  const steps = [];
  const browser = await chromium.launch();

  // A page signed in as `who` (or a visitor), recording the site's /api traffic and page errors.
  async function open(who) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    if (target.access) {
      await ctx.route(`${target.site}/**`, (route) => route.continue({ headers: { ...route.request().headers(), ...target.access } }));
    }
    if (who) await ctx.addInitScript(([k, s]) => localStorage.setItem(k, s), [target.storageKey, JSON.stringify(who.session)]);
    const p = await ctx.newPage();
    p.api = [];
    p.errors = [];
    p.on('response', (res) => { const u = new URL(res.url()); if (u.origin === target.site && u.pathname.startsWith('/api/')) p.api.push(`${res.request().method()} ${u.pathname} ${res.status()}`); });
    p.on('pageerror', (e) => p.errors.push(String(e.message).slice(0, 200)));
    p.on('dialog', (d) => d.accept());
    return p;
  }
  async function step(group, name, p, run) {
    const before = p.api.length;
    let pass = false;
    let note = '';
    try {
      const out = await run();
      pass = out !== false;
      if (typeof out === 'string') note = out;
    } catch (error) {
      note = String(error.message ?? error).split('\n')[0].slice(0, 300);
    }
    const api = p.api.slice(before);
    const serverErrors = api.filter((a) => / 5\d\d$/.test(a));
    if (serverErrors.length) { pass = false; note = `${note} server errors: ${serverErrors.join(', ')}`.trim(); }
    if (p.errors.length) { pass = false; note = `${note} page errors: ${p.errors.splice(0).join(' | ')}`.trim(); }
    const file = `${String(steps.length + 1).padStart(2, '0')}-${group}-${name.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.png`;
    await p.screenshot({ path: join(shots, file) }).catch(() => {});
    steps.push({ group, name, pass, note: note || undefined, api, screenshot: file });
    log(`${pass ? 'PASS' : 'FAIL'} ${group} ${name}${note ? ` - ${note}` : ''}`);
  }
  const go = (p, path) => p.goto(`${target.site}${path}`, { waitUntil: 'domcontentloaded' });

  try {
    log(`fixtures (${tag})`);
    const fx = await createFixtures(db, tag, made);
    const { who, home, match, linked } = fx;
    await db.insert('predictions', [{ user_id: who.normal.id, match_id: match.id, predicted_home_score: 1, predicted_away_score: 0, predicted_scorers: [], predicted_assists: [], status: 'pending' }]);

    // G1, G2, G3, G7 public screens, as a visitor
    const v = await open(null);
    await step('G1', 'division home loads its dashboard', v, async () => {
      await go(v, '/super-league');
      await v.waitForResponse((r) => r.url().includes('/api/home/dashboard') && r.status() === 200, { timeout: 30000 });
    });
    await step('G2', 'standings list the entered teams', v, async () => {
      await go(v, '/standings/super-league');
      await v.getByText(`${tag} Home`).first().waitFor({ timeout: 30000 });
    });
    await step('G2', 'matches list the fixture', v, async () => {
      await go(v, '/matches');
      await v.getByText(`${tag} Home`).first().waitFor({ timeout: 30000 });
    });
    await step('G3', 'teams list the entered team', v, async () => {
      await go(v, '/teams');
      await v.getByText(`${tag} Home`).first().waitFor({ timeout: 30000 });
    });
    await step('G7', 'the news vault loads', v, async () => {
      await go(v, '/vault');
      await v.waitForResponse((r) => r.url().includes('/api/news') && r.status() === 200, { timeout: 30000 });
    });

    // G4 + G8: a linked player edits their card and uploads a portrait
    const pl = await open(who.player);
    await step('G4', 'a linked player saves their card with a new portrait', pl, async () => {
      await go(pl, '/profile');
      const card = pl.getByRole('region', { name: 'Your player card' }).or(pl.locator('section[aria-label="Your player card"]'));
      await card.getByLabel('Preferred foot').waitFor({ timeout: 30000 });
      await card.getByLabel('Preferred foot').selectOption('Left');
      await card.getByLabel('Portrait file').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png(500) });
      await card.getByRole('button', { name: /save card/i }).click();
      for (let i = 0; i < 40; i += 1) {
        const [row] = await db.select('players', `select=image_url,attributes&id=eq.${linked.data}`);
        if (row?.image_url?.includes(`/players/${linked.data}.png`) && row?.attributes?.bio?.preferredFoot === 'Left') return 'portrait and foot stored';
        await pl.waitForTimeout(500);
      }
      return false;
    });

    // G7 + G8: an editor publishes an article with a hero image
    const ed = await open(who.editor);
    await step('G7', 'an editor publishes an article with an uploaded image', ed, async () => {
      await go(ed, '/editor');
      await ed.getByPlaceholder('Headline / Title').waitFor({ timeout: 30000 });
      await ed.getByPlaceholder('Headline / Title').fill(`${tag} walkthrough article`);
      await ed.getByPlaceholder('Short Summary (Subtitle)').fill('Parity walkthrough');
      await ed.locator('input[type="file"]').first().setInputFiles({ name: 'hero.png', mimeType: 'image/png', buffer: png(64) });
      for (const box of await ed.getByPlaceholder('Write a paragraph...').all()) await box.fill('Parity walkthrough paragraph.');
      await ed.getByRole('button', { name: /publish article/i }).click();
      for (let i = 0; i < 40; i += 1) {
        const rows = await db.select('newsletter', `select=id,image_url&title=eq.${encodeURIComponent(`${tag} walkthrough article`)}`);
        if (rows.length) { made.news.push(...rows.map((r) => r.id)); return rows[0].image_url ? 'published with its image' : false; }
        await ed.waitForTimeout(500);
      }
      return false;
    });

    // G6: the captain edits their team details
    const cp = await open(who.captain);
    await step('G6', 'the captain saves their team details', cp, async () => {
      await go(cp, '/team-builder');
      await cp.getByRole('button', { name: /edit team details/i }).waitFor({ timeout: 30000 });
      await cp.getByRole('button', { name: /edit team details/i }).click();
      await cp.getByLabel('Team name').fill(`${tag} Home United`);
      await cp.getByRole('button', { name: /save team details/i }).click();
      await cp.getByText(/Team details saved/).first().waitFor({ timeout: 30000 });
      const [row] = await db.select('teams', `select=name&id=eq.${home.id}`);
      return row?.name === `${tag} Home United` || false;
    });

    // G6: the assigned scorer records a goal and closes the match
    const sc = await open(who.scorer);
    await step('G6', 'the assigned scorer records a goal and the final whistle', sc, async () => {
      await go(sc, '/dictator');
      await sc.getByRole('button', { name: 'Live Matches' }).waitFor({ timeout: 30000 });
      await sc.waitForTimeout(3000);
      const label = sc.getByText(new RegExp(`${tag} Home( United)? vs ${tag} Away`)).first();
      if (!(await label.isVisible().catch(() => false))) await sc.getByRole('button', { name: 'Super League' }).first().click().catch(() => {});
      await label.waitFor({ timeout: 30000 });
      await label.click();
      await sc.getByRole('button', { name: '+1 Home' }).click();
      for (let i = 0; i < 30; i += 1) {
        const [m] = await db.select('matches', `select=home_score&id=eq.${match.id}`);
        if (m?.home_score === 1) break;
        await sc.waitForTimeout(500);
      }
      await sc.getByRole('button', { name: /final whistle/i }).click();
      for (let i = 0; i < 30; i += 1) {
        const [m] = await db.select('matches', `select=home_score,status&id=eq.${match.id}`);
        if (m?.home_score === 1 && m?.status === 'completed') return 'goal stored and match completed';
        await sc.waitForTimeout(500);
      }
      return false;
    });

    // G5: the dictator grades the match; the fan sees the graded prediction
    const dc = await open(who.dictator);
    await step('G5', 'the dictator grades the match from the dashboard', dc, async () => {
      await go(dc, '/dictator');
      await dc.getByRole('button', { name: 'Grade Fantasy' }).click({ timeout: 30000 });
      await dc.waitForTimeout(3000);
      const row = dc.locator('div, li, tr').filter({ hasText: new RegExp(`${tag} Home`) }).filter({ has: dc.getByRole('button', { name: /Grade Match/ }) }).last();
      await row.waitFor({ timeout: 30000 });
      await row.getByRole('button', { name: /Grade Match/ }).click();
      for (let i = 0; i < 30; i += 1) {
        const [pr] = await db.select('predictions', `select=status,points_awarded&match_id=eq.${match.id}`);
        if (pr?.status === 'graded') return `graded, ${pr.points_awarded} points`;
        await dc.waitForTimeout(500);
      }
      return false;
    });
    const fan = await open(who.normal);
    await step('G5', 'the fan sees the points of their graded prediction in fantasy', fan, async () => {
      await go(fan, '/fantasy');
      // The page opens on the World Cup tab; the season's own fantasy is the other toggle.
      const fifa = fan.getByRole('button', { name: 'FIFA', exact: true });
      await fifa.waitFor({ timeout: 30000 });
      await fifa.locator('xpath=..').getByRole('button').first().click();
      const [pr] = await db.select('predictions', `select=points_awarded&match_id=eq.${match.id}`);
      await fan.getByText(String(pr.points_awarded), { exact: true }).first().waitFor({ timeout: 30000 });
      if (!fan.api.some((a) => a.startsWith('GET /api/predictions/leaderboard 200'))) return false;
      return `${pr.points_awarded} points shown`;
    });
  } finally {
    await browser.close();
    log('cleanup');
    await cleanupFixtures(db, made);
    await target.close();
  }

  const passed = steps.length > 0 && steps.every((s) => s.pass);
  const groups = [...new Set(steps.map((s) => s.group))].sort();
  process.stdout.write(`${JSON.stringify({ item: 'SL-032', target: target.name, site: target.site, recordedAt: new Date().toISOString(), screenshots: shots, groups, passed, steps }, null, 2)}\n`);
  process.exitCode = passed ? 0 : 1;
}

main().catch((error) => {
  log(`parity walkthrough: ${error?.stack ?? error}`);
  process.exit(1);
});
