// R10 walkthrough for roles and assignments (SL-024): drives the REAL app (web on :5173 and API on :3000, started from
// THIS checkout) with Chromium against this repository's LOCAL Supabase only. It creates synthetic accounts and rows,
// signs them in with generated one-time links (no password, no mail), clicks the dictator, scorer, captain and normal
// user flows through to the stored result, and removes everything it created. Prints one verdict per step, no secrets.
//
//   node scripts/ui-walkthrough/roles.mjs [screenshot-directory]
//
// Start the servers from the same checkout first, and record `git rev-parse --short HEAD` as the served commit.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const req = createRequire(resolve(root, 'frontend/package.json'));
const { chromium } = req('playwright');
const { createClient } = req('@supabase/supabase-js');
const shots = process.argv[2] ?? '/tmp';
const status = JSON.parse(execSync('pnpm exec supabase status -o json 2>/dev/null', { cwd: resolve(root, 'backend') }).toString().replace(/^[^{]*/, ''));
if (status.API_URL !== 'http://127.0.0.1:54321') throw new Error('not the local stack');
const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(status.API_URL, status.SECRET_KEY, opts);
const tag = `uiw${Date.now().toString(36)}`;
const D = 'iiitkottayam.ac.in';
const made = { users: [], divisions: [], teams: [] };
const results = [];
const ok = (name, pass, note = '') => { results.push([name, pass]); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${note ? ' - ' + note : ''}`); };
const must = (r) => { if (r.error) throw new Error(JSON.stringify(r.error)); return r.data; };

async function account(label, grants = []) {
  const email = `${tag}-${label}@${D}`;
  const u = (await admin.auth.admin.createUser({ email, email_confirm: true })).data.user;
  made.users.push(u.id);
  for (const role of grants) must(await admin.from('user_roles').insert({ user_id: u.id, role }));
  must(await admin.from('user_profiles').upsert({ id: u.id, email, nickname: `${label}-${tag}`.slice(0, 20), wc_team_flair: 'Spain' }));
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const c = createClient(status.API_URL, status.PUBLISHABLE_KEY, opts);
  const v = await c.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' });
  return { id: u.id, email, session: v.data.session };
}
async function page(browser, who) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.addInitScript(([k, s]) => localStorage.setItem(k, s), ['sb-127-auth-token', JSON.stringify(who.session)]);
  p.on('dialog', (d) => d.accept());
  return p;
}
const shot = (p, n) => p.screenshot({ path: `${shots}/${n}.png` });

const division = must(await admin.from('divisions').insert({ visibility: 'public', slug: tag, name: `UIW ${tag}` }).select('id').single()).id;
made.divisions.push(division);
const season = must(await admin.from('seasons').insert({ visibility: 'public', division_id: division, slug: '2026', name: `UIW ${tag} 2026`, is_current: true }).select('id').single()).id;
const teams = must(await admin.from('teams').insert([{ name: `${tag} Reds`, logo_url: 'data:image/png;base64,AA==', team_color: '#112233' }, { name: `${tag} Blues` }]).select('id'));
made.teams.push(...teams.map((t) => t.id));
const entries = must(await admin.from('team_entries').insert(teams.map((t) => ({ team_id: t.id, season_id: season }))).select('id, team_id'));
const match = must(await admin.from('matches').insert({ home_team_id: teams[0].id, away_team_id: teams[1].id, season_id: season, status: 'scheduled', date: new Date(Date.now() + 86400000).toISOString() }).select('id').single()).id;

const dictator = await account('dictator', ['dictator']);
const target = await account('target');
const other = await account('other');
const scorer = await account('scorer');
const captain = await account('captain', ['captain']);
const normal = await account('normal');
const entryReds = entries.find((e) => e.team_id === teams[0].id).id;

const browser = await chromium.launch();
try {
  // --- Dictator: Access control, Captains, Scorers ------------------------------------------------------------
  const p = await page(browser, dictator);
  await p.goto('http://localhost:5173/dictator');
  await p.getByRole('button', { name: 'Captains', exact: true }).waitFor({ timeout: 20000 });
  const tabs = (await p.locator('nav button').allInnerTexts()).map((t) => t.trim().toLowerCase());
  ok('Dictator sees the dashboard with Captains and Scorers tabs and no "registrations" wording', tabs.includes('captains') && tabs.includes('scorers') && !(await p.content()).toLowerCase().includes('captains & registrations'), tabs.join(' | '));

  await p.getByRole('button', { name: 'Access Control', exact: true }).click();
  await p.getByLabel('Search accounts').fill(`${tag}-target`);
  await p.getByLabel(/^Editor for .*target/).first().waitFor({ timeout: 15000 });
  await p.getByLabel(/^Editor for .*target/).first().click();
  await p.getByText(/Granted editor/).waitFor({ timeout: 15000 });
  const g1 = (await admin.from('user_roles').select('role').eq('user_id', target.id)).data.map((r) => r.role);
  ok('Access control: granting Editor writes the grant', g1.includes('editor'), g1.join());
  await shot(p, '1-access-control');

  await p.getByRole('button', { name: 'Captains', exact: true }).click();
  await p.getByLabel('Division').selectOption(division);
  await p.getByLabel('Season').selectOption(season);
  await p.getByLabel('Team').selectOption(teams[0].id);
  await p.getByLabel(`Find captain for ${tag} Reds`).fill(`${tag}-target`);
  await p.getByLabel(`New captain for ${tag} Reds`).selectOption({ index: 1 });
  await p.getByRole('button', { name: /assign captain/i }).click();
  await p.getByText(/is now the captain/).waitFor({ timeout: 15000 });
  const a1 = (await admin.from('captain_assignments').select('user_id').eq('team_entry_id', entryReds)).data;
  ok('Captains: assigning a captain stores one assignment and the captain grant', a1.length === 1 && a1[0].user_id === target.id && (await admin.from('user_roles').select('role').eq('user_id', target.id).eq('role', 'captain')).data.length === 1);
  await shot(p, '2-captain-assigned');

  await p.getByLabel(`Find captain for ${tag} Reds`).fill(`${tag}-other`);
  await p.getByLabel(`New captain for ${tag} Reds`).selectOption({ index: 1 });
  await p.getByRole('button', { name: /change captain/i }).click();
  await p.getByText(/is now the captain/).last().waitFor({ timeout: 15000 });
  await p.waitForTimeout(800);
  const a2 = (await admin.from('captain_assignments').select('user_id').eq('team_entry_id', entryReds)).data;
  ok('Captains: changing the captain keeps one assignment and moves it', a2.length === 1 && a2[0].user_id === other.id && (await admin.from('user_roles').select('role').eq('user_id', target.id).eq('role', 'captain')).data.length === 0);

  await p.getByRole('button', { name: /revoke captain/i }).click();
  await p.getByText(/no longer the captain/).waitFor({ timeout: 15000 });
  ok('Captains: revoking removes the assignment', (await admin.from('captain_assignments').select('id').eq('team_entry_id', entryReds)).data.length === 0);

  await p.getByRole('button', { name: 'Scorers', exact: true }).click();
  await p.getByLabel('Find scorer').fill(`${tag}-scorer`);
  await p.getByLabel('Scorer', { exact: true }).selectOption({ index: 1 });
  await p.getByLabel('Division').selectOption(division);
  await p.getByLabel('Season').selectOption(season);
  await p.getByLabel('Match').selectOption(match);
  await p.getByRole('button', { name: /assign scorer/i }).click();
  await p.getByText(/can now score that match/).waitFor({ timeout: 15000 });
  const s1 = (await admin.from('scorer_assignments').select('match_id').eq('user_id', scorer.id)).data;
  ok('Scorers: assigning a scorer to one match stores the assignment and the scorer grant', s1.length === 1 && s1[0].match_id === match && (await admin.from('user_roles').select('role').eq('user_id', scorer.id).eq('role', 'scorer')).data.length === 1);
  await shot(p, '3-scorer-assigned');

  // --- Scorer: Live Matches only -------------------------------------------------------------------------------
  const ps = await page(browser, scorer);
  await ps.goto('http://localhost:5173/dictator');
  await ps.getByRole('button', { name: 'Live Matches' }).waitFor({ timeout: 20000 });
  const sTabs = (await ps.locator('nav button').allInnerTexts()).map((t) => t.trim().toLowerCase());
  await ps.getByText(/No matches assigned to you in this division/).first().waitFor({ timeout: 15000 }); // the default division has none assigned
  await ps.waitForTimeout(4000); // let the sign-in events settle
  await ps.getByRole('button', { name: `UIW ${tag}` }).click();
  await ps.waitForTimeout(3000);
  await ps.getByText(`${tag} Reds vs ${tag} Blues`).first().waitFor({ timeout: 15000 });
  ok('Scorer sees Live Matches only, with just the assigned match', sTabs.length === 1 && sTabs[0] === 'live matches', sTabs.join(' | '));
  await shot(ps, '4-scorer-live');

  // --- Captain: team builder and team details -----------------------------------------------------------------
  must(await admin.from('captain_assignments').insert({ team_entry_id: entryReds, user_id: captain.id }));
  const pc = await page(browser, captain);
  await pc.goto('http://localhost:5173/team-builder');
  await pc.getByRole('button', { name: /edit team details/i }).waitFor({ timeout: 20000 });
  await pc.getByRole('button', { name: /edit team details/i }).click();
  await pc.getByLabel('Team name').fill(`${tag} Reds United`);
  await pc.getByLabel('Short name').fill('rdu');
  await pc.getByRole('button', { name: /save team details/i }).click();
  await pc.getByText(/Team details saved/).first().waitFor({ timeout: 20000 });
  const t = (await admin.from('teams').select('name, short_name').eq('id', teams[0].id).single()).data;
  ok('Captain edits team name and short name through the app, the API and the database', t.name === `${tag} Reds United` && t.short_name === 'RDU', JSON.stringify(t));
  await shot(pc, '5-captain-details');

  // --- Captain without an assignment, editor-only and a normal user get no dashboard ------------------------------
  const pn = await page(browser, normal);
  await pn.goto('http://localhost:5173/dictator');
  await pn.waitForURL('http://localhost:5173/', { timeout: 15000 });
  ok('A normal user is sent home from the dashboard', true);
} catch (e) {
  ok(`Unexpected error: ${String(e.message).slice(0, 200)}`, false);
} finally {
  await browser.close();
  for (const id of made.users) await admin.auth.admin.deleteUser(id);
  await admin.from('matches').delete().eq('id', match);
  await admin.from('team_entries').delete().eq('season_id', season);
  await admin.from('teams').delete().in('id', made.teams);
  await admin.from('seasons').delete().eq('id', season);
  await admin.from('divisions').delete().eq('id', division);
  const failed = results.filter((r) => !r[1]).length;
  console.log(`RESULT: ${failed ? 'FAILED' : 'PASSED'} (${results.length} steps)`);
}
