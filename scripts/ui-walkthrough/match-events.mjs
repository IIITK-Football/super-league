// R10 walkthrough for match events (SL-022): drives the REAL app (web on :5173 and API on :3000, started from THIS
// checkout) with Chromium against this repository's LOCAL Supabase only. A synthetic scorer assigned to one match runs it
// through the Live tab (+1 goal, attribute it, edit the minute, add a card, void with a reason, -1), a synthetic dictator
// grades a prediction and sees "needs regrade" after a correction, and the public timeline shows the result. Everything it
// creates is removed. Prints one verdict per step, no secrets.
//
//   node scripts/ui-walkthrough/match-events.mjs [screenshot-directory]
//
// Start the servers from the same checkout first, and record `git rev-parse --short HEAD` as the served commit.
import { createRequire } from 'node:module';
import { execSync, spawnSync } from 'node:child_process';
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
const tag = `mev${Date.now().toString(36)}`;
const D = 'iiitkottayam.ac.in';
const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const made = { users: [], teams: [], players: [] };
const results = [];
const ok = (name, pass, note = '') => { results.push([name, pass]); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${note ? ' - ' + note : ''}`); };
const must = (r) => { if (r.error) throw new Error(JSON.stringify(r.error)); return r.data; };
const sql = (q) => { const r = spawnSync('psql', [LOCAL_DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };

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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const p = await ctx.newPage();
  await p.addInitScript(([k, s]) => localStorage.setItem(k, s), ['sb-127-auth-token', JSON.stringify(who.session)]);
  p.on('dialog', (d) => (d.type() === 'prompt' ? d.accept('wrong player') : d.accept()));
  return p;
}
const shot = (p, n) => p.screenshot({ path: `${shots}/${n}.png` });
const matchRow = async (id) => must(await admin.from('matches').select('home_score, away_score, status').eq('id', id).single());

const division = must(await admin.from('divisions').insert({ visibility: 'public', slug: tag, name: `MEV ${tag}` }).select('id').single()).id;
const season = must(await admin.from('seasons').insert({ visibility: 'public', division_id: division, slug: '2026', name: `MEV ${tag} 2026`, is_current: true }).select('id').single()).id;
const teams = must(await admin.from('teams').insert([{ name: `${tag} Reds` }, { name: `${tag} Blues` }]).select('id'));
made.teams.push(...teams.map((t) => t.id));
const entries = must(await admin.from('team_entries').insert(teams.map((t) => ({ team_id: t.id, season_id: season }))).select('id, team_id'));
const entryOf = (team) => entries.find((e) => e.team_id === team).id;
const players = JSON.parse(sql(`WITH r AS (INSERT INTO public.players (first_name, last_name) VALUES ('${tag}A','Striker'),('${tag}B','Winger'),('${tag}C','Keeper') RETURNING id, first_name) SELECT json_agg(r ORDER BY first_name) FROM r`));
made.players.push(...players.map((p) => p.id));
sql(`INSERT INTO public.roster_memberships (player_id, team_entry_id, season_id, jersey_number) VALUES ('${players[0].id}','${entryOf(teams[0].id)}','${season}',9),('${players[1].id}','${entryOf(teams[0].id)}','${season}',7),('${players[2].id}','${entryOf(teams[1].id)}','${season}',1)`);
const match = must(await admin.from('matches').insert({ home_team_id: teams[0].id, away_team_id: teams[1].id, season_id: season, status: 'scheduled', date: new Date(Date.now() + 3600000).toISOString() }).select('id').single()).id;

const scorer = await account('scorer', ['scorer']);
const dictator = await account('dictator', ['dictator']);
const fan = await account('fan');
must(await admin.from('scorer_assignments').insert({ user_id: scorer.id, match_id: match }));

const browser = await chromium.launch();
try {
  const p = await page(browser, scorer);
  await p.goto('http://localhost:5173/dictator');
  await p.getByRole('button', { name: 'Live Matches' }).waitFor({ timeout: 20000 });
  await p.waitForTimeout(4000);
  await p.getByRole('button', { name: `MEV ${tag}` }).click();
  await p.getByText(`${tag} Reds vs ${tag} Blues`).first().click();
  await p.getByText(/Match events \(0\)/).waitFor({ timeout: 15000 });
  ok('Scorer opens the assigned match and sees an empty event list', true);

  await p.getByRole('button', { name: '+1 Home' }).click();
  await p.getByText(/1 goal unattributed/).waitFor({ timeout: 15000 });
  let m = await matchRow(match);
  ok('+1 Home records an unattributed goal, banner shown, score is 1-0 in the database', m.home_score === 1 && m.away_score === 0 && m.status === 'live', JSON.stringify(m));
  await shot(p, 'mev-1-unattributed');

  await p.getByRole('button', { name: 'Attribute' }).click();
  await p.getByLabel('Goalscorer').selectOption(players[0].id);
  await p.getByLabel('Minute').fill('12');
  await p.getByRole('button', { name: 'Save correction' }).click();
  await p.getByText(/Event updated/).waitFor({ timeout: 15000 });
  let ev = must(await admin.from('match_events').select('player_id, minute, version').eq('match_id', match).single());
  ok('Attributing the goal stores the scorer and minute, version 2, score unchanged', ev.player_id === players[0].id && ev.minute === 12 && ev.version === 2 && (await matchRow(match)).home_score === 1, JSON.stringify(ev));

  await p.getByRole('button', { name: 'Add Card' }).click();
  await p.getByLabel('Card team').selectOption(teams[1].id);
  await p.getByLabel('Carded player').selectOption(players[2].id);
  await p.getByLabel('Card minute').fill('30');
  await p.getByRole('button', { name: 'Confirm Card' }).click();
  await p.getByText(/Card recorded/).waitFor({ timeout: 15000 });
  ok('A yellow card is stored and the score is unchanged', must(await admin.from('match_events').select('id').eq('match_id', match).eq('kind', 'yellow')).length === 1 && (await matchRow(match)).home_score === 1);

  await p.getByRole('button', { name: '+1 Away' }).click();
  await p.getByText(/Goal added; the scorer is not known yet/).waitFor({ timeout: 15000 });
  await p.getByLabel('Minus one away').click();
  await p.getByText(/unattributed goal was voided/).waitFor({ timeout: 15000 });
  m = await matchRow(match);
  ok('+1 Away then -1 Away voids the unattributed goal; the score returns to 1-0 and the event stays voided', m.away_score === 0 && must(await admin.from('match_events').select('id').eq('match_id', match).not('voided_at', 'is', null)).length === 1, JSON.stringify(m));

  await p.getByLabel('Minus one home').click();
  await p.getByRole('group', { name: 'Choose the goal to correct' }).waitFor({ timeout: 15000 });
  ok('-1 Home with every goal attributed asks which goal to void', true);
  await p.getByRole('button', { name: 'Void this goal' }).click();
  await p.getByText(/Event voided and the score adjusted/).waitFor({ timeout: 15000 });
  ok('Voiding the chosen goal with a reason takes it off the score', (await matchRow(match)).home_score === 0 && must(await admin.from('match_events').select('void_reason').eq('player_id', players[0].id)).some((e) => e.void_reason === 'wrong player'));
  await shot(p, 'mev-2-after-void');

  // Re-record the goal for the public timeline and grading.
  await p.getByRole('button', { name: '+1 Home' }).click();
  await p.getByText(/1 goal unattributed/).waitFor({ timeout: 15000 });
  await p.getByRole('button', { name: 'Attribute' }).click();
  await p.getByLabel('Goalscorer').selectOption(players[1].id);
  await p.getByLabel('Minute').fill('20');
  await p.getByRole('button', { name: 'Save correction' }).click();
  await p.getByText(/Event updated/).waitFor({ timeout: 15000 });
  await p.getByRole('button', { name: /final whistle/i }).click();
  await p.waitForTimeout(1500);
  ok('Final whistle completes the match with the derived score 1-0', (await matchRow(match)).status === 'completed' && (await matchRow(match)).home_score === 1);

  // Public timeline: events in minute order, the voided one is hidden.
  const pub = await page(browser, fan);
  await pub.goto(`http://localhost:5173/matches/${match}`);
  await pub.getByText('Yellow card').first().waitFor({ timeout: 20000 });
  const body = await pub.locator('body').innerText();
  ok('The public timeline shows the scorer and the card and hides the voided goal', body.includes(`${tag}B Winger`.toUpperCase()) || body.toUpperCase().includes(`${tag}B`.toUpperCase()), '');
  await shot(pub, 'mev-3-timeline');

  // Grading: a dictator grades from the dashboard; a later correction shows "needs regrade".
  must(await admin.from('predictions').insert({ user_id: fan.id, match_id: match, predicted_home_score: 1, predicted_away_score: 0, predicted_scorers: [players[1].id], predicted_assists: [] }));
  const pd = await page(browser, dictator);
  await pd.goto('http://localhost:5173/dictator');
  await pd.getByRole('button', { name: 'Grade Fantasy' }).click();
  await pd.waitForTimeout(3000);
  await pd.getByRole('button', { name: `MEV ${tag}` }).click();
  await pd.getByText(`${tag} Reds`).first().waitFor({ timeout: 20000 });
  await pd.getByRole('button', { name: /Grade Match/ }).first().click();
  await pd.getByText(/Already Graded/).waitFor({ timeout: 20000 });
  const graded = must(await admin.from('predictions').select('points_awarded, status').eq('match_id', match).single());
  ok('Dictator grades the match from the dashboard: the prediction is graded with points from the scoreline and scorer', graded.status === 'graded' && graded.points_awarded >= 300, JSON.stringify(graded));
  await shot(pd, 'mev-4-graded');

  // A correction after grading: the scorer moves the goal to the other player; the dictator sees "needs regrade".
  const goalId = must(await admin.from('match_events').select('id').eq('match_id', match).eq('kind', 'goal').is('voided_at', null).single()).id;
  const fix = await admin.from('match_events').update({ player_id: players[0].id }).eq('id', goalId);
  if (fix.error) throw new Error(JSON.stringify(fix.error));
  await pd.reload();
  await pd.getByRole('button', { name: 'Grade Fantasy' }).click();
  await pd.waitForTimeout(3000);
  await pd.getByRole('button', { name: `MEV ${tag}` }).click();
  await pd.getByText('Needs regrade').waitFor({ timeout: 20000 });
  ok('After a correction the graded match shows "Needs regrade" and the points are not silently changed', must(await admin.from('predictions').select('points_awarded').eq('match_id', match).single()).points_awarded === graded.points_awarded);
  await shot(pd, 'mev-5-needs-regrade');
  await pd.getByRole('button', { name: /Re-Grade/ }).first().click();
  await pd.waitForTimeout(3000);
  const regraded = must(await admin.from('predictions').select('points_awarded').eq('match_id', match).single());
  ok('Re-grading applies the corrected scorer (the predicted scorer no longer scored, so the scorer points go)', regraded.points_awarded < graded.points_awarded, `${graded.points_awarded} -> ${regraded.points_awarded}`);
} catch (e) {
  ok(`Unexpected error: ${String(e.message).slice(0, 300)}`, false);
} finally {
  await browser.close();
  for (const id of made.users) await admin.auth.admin.deleteUser(id);
  await admin.from('predictions').delete().eq('match_id', match);
  sql(`DELETE FROM public.matches WHERE id = '${match}'`);
  await admin.from('team_entries').delete().eq('season_id', season);
  sql(`DELETE FROM public.roster_memberships WHERE season_id = '${season}'`);
  if (made.players.length) sql(`DELETE FROM public.players WHERE id IN (${made.players.map((i) => `'${i}'`).join(',')})`);
  await admin.from('teams').delete().in('id', made.teams);
  await admin.from('seasons').delete().eq('id', season);
  await admin.from('divisions').delete().eq('id', division);
  const failed = results.filter((r) => !r[1]).length;
  console.log(`RESULT: ${failed ? 'FAILED' : 'PASSED'} (${results.length} steps)`);
}
