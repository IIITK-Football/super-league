#!/usr/bin/env node
// SL-032 parity runner: every active contract group of docs/contracts/worker-compatibility.md, through the site origin
// (browser path: Pages function → API binding → Worker → Data API), as the real callers, with refusals and state checks.
//
//   node scripts/parity/verify-parity.mjs --target local     builds the site and serves it with wrangler pages dev
//                                                          bound to wrangler dev, against THIS repository's local stack
//   node scripts/parity/verify-parity.mjs --target staging   https://develop.super-league.pages.dev (or STAGING_SITE_URL,
//                                                          a *.super-league.pages.dev preview URL), behind Access
//   add --previous for a restored pair from before SL-031 (no /version.json)
//
// Per run it creates tagged temporary accounts (dictator, editor, captain, scorer, unassigned scorer, normal user,
// linked players) and tagged teams, entries, players and a match in the current Super League season, and deletes
// them at the end. Uploaded test images stay in the target's buckets (staging and local only). Never production.
// Prints one JSON evidence document to standard output; progress to standard error. Exit 1 on any fail or gap.
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReport, localProblems, png, serverApi, start, stop, waitFor } from './lib.mjs';
import { loadEnvText, STAGING_REF, verifyTarget } from '../staging-checks.mjs';
import { accessHeaders, verifySite } from '../staging-media-check.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');
const log = (line) => process.stderr.write(`${line}\n`);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };

async function localTarget() {
  const r = spawnSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], { encoding: 'utf8', cwd: join(REPO, 'backend') });
  if (r.status !== 0) throw new Error('local Supabase is not running (pnpm db:start).');
  const status = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  const problems = localProblems(status, readFileSync(join(REPO, 'api/.dev.vars'), 'utf8'));
  if (problems.length) throw new Error(problems.join('; '));
  for (const port of [8787, 8790]) {
    const taken = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
    if (taken) throw new Error(`port ${port} is already serving; stop that server first so the evidence comes from this run.`);
  }
  log('building the frontend');
  const build = spawnSync(join(REPO, 'frontend/node_modules/.bin/vite'), ['build'], { cwd: join(REPO, 'frontend'), encoding: 'utf8' });
  if (build.status !== 0) throw new Error(`frontend build failed:\n${build.stderr.slice(-1500)}`);
  const wrangler = join(REPO, 'api/node_modules/.bin/wrangler');
  const worker = start('the API Worker', wrangler, ['dev', '--port', '8787', '--ip', '127.0.0.1', '--show-interactive-dev-session=false'], join(REPO, 'api'));
  await waitFor('http://127.0.0.1:8787/api/health', worker);
  const pages = start('the Pages site', wrangler, ['pages', 'dev', 'dist', '--port', '8790', '--ip', '127.0.0.1', '--service', 'API=super-league-api', '--show-interactive-dev-session=false'], join(REPO, 'frontend'));
  await waitFor('http://127.0.0.1:8790/version.json', pages);
  return {
    name: 'local', environment: 'local', site: 'http://127.0.0.1:8790', headers: {},
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
    name: 'staging', environment: 'staging', site, headers: accessHeaders(),
    db: serverApi({ url: `https://${STAGING_REF}.supabase.co`, secretKey: env.SUPABASE_SECRET_KEY, publishableKey: env.SUPABASE_PUBLISHABLE_KEY }),
    close: async () => {},
  };
}

async function main() {
  const targetName = arg('--target');
  if (!['local', 'staging'].includes(targetName)) throw new Error('use --target local or --target staging');
  const previous = process.argv.includes('--previous');
  const target = targetName === 'local' ? await localTarget() : await stagingTarget();
  const { db } = target;
  const report = createReport();
  const tag = `par${Date.now().toString(36)}`;
  const made = { users: [], teams: [], entries: [], players: [], matches: [], news: [] };

  // The site origin, as a caller (token) or a visitor (null).
  const site = async (path, { token = null, method = 'GET', json, form } = {}) => {
    const headers = { ...target.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    let body;
    if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    if (form) body = form;
    const res = await fetch(`${target.site}${path}`, { method, headers, body, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) throw new Error('Cloudflare Access refused the service token (redirect)');
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, body: data, cache: res.headers.get('Cache-Control') };
  };
  const servesPng = async (url) => {
    if (!url) return false;
    const u = new URL(url);
    // Locally the media base names the Vite dev origin; the same /api/local-media path is served by the Worker here.
    const fetchUrl = target.name === 'local' ? `${target.site}${u.pathname}` : url;
    const r = await fetch(fetchUrl, { headers: target.name === 'local' ? {} : {} });
    const b = new Uint8Array(await r.arrayBuffer());
    return r.ok && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  };
  const file = (size, name) => new File([png(size)], name, { type: 'image/png' });
  const C = report.check;

  try {
    // ---- Fixtures ------------------------------------------------------------------------------------------------
    log(`fixtures (${tag})`);
    const [season] = await db.select('seasons', 'select=id,division_id,divisions!inner(slug)&divisions.slug=eq.super-league&is_current=eq.true');
    if (!season) throw new Error('no current Super League season on the target');
    const who = {};
    for (const [label, roles] of [['dictator', ['dictator']], ['editor', ['editor']], ['captain', ['captain']], ['scorer', ['scorer']], ['loose', ['scorer']], ['normal', []], ['player', []], ['away', []]]) {
      who[label] = await db.account(`sl-check-${tag}-${label}@iiitkottayam.ac.in`);
      made.users.push(who[label].id);
      await db.call('/rest/v1/user_profiles', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: who[label].id, email: who[label].email, nickname: `${label}-${tag}`.slice(0, 20) }) });
      for (const role of roles) await db.insert('user_roles', [{ user_id: who[label].id, role }]);
    }
    const teams = await db.insert('teams', [
      { name: `${tag} Home`, short_name: 'PHM', team_color: '#000000', logo_url: 'data:image/png;base64,AA==' },
      { name: `${tag} Away`, short_name: 'PAW', team_color: '#ffffff', logo_url: 'data:image/png;base64,AA==' },
    ]);
    made.teams.push(...teams.map((t) => t.id));
    const [home, away] = teams;
    const entries = await db.insert('team_entries', [{ team_id: home.id, season_id: season.id }, { team_id: away.id, season_id: season.id }]);
    made.entries.push(...entries.map((e) => e.id));
    const homeEntry = entries.find((e) => e.team_id === home.id);
    const awayEntry = entries.find((e) => e.team_id === away.id);
    await db.insert('captain_assignments', [{ team_entry_id: homeEntry.id, user_id: who.captain.id }]);
    const asDictator = db.as(who.dictator.token);
    const linked = await asDictator('/rest/v1/rpc/create_player_for_account', { method: 'POST', body: JSON.stringify({ p_user: who.player.id, p_team_entry_id: homeEntry.id, p_first_name: tag, p_last_name: 'Linked', p_jersey_number: 7, p_position: null, p_overall_rating: null, p_attributes: null, p_image_url: null }) });
    const awayPlayer = await asDictator('/rest/v1/rpc/create_player_for_account', { method: 'POST', body: JSON.stringify({ p_user: who.away.id, p_team_entry_id: awayEntry.id, p_first_name: tag, p_last_name: 'Away', p_jersey_number: 9, p_position: null, p_overall_rating: null, p_attributes: null, p_image_url: null }) });
    if (linked.status >= 300 || awayPlayer.status >= 300) throw new Error(`could not create the fixture players (${linked.status}/${awayPlayer.status}): ${JSON.stringify(linked.data).slice(0, 200)}`);
    made.players.push(linked.data, awayPlayer.data);
    const [homePlace] = await db.select('roster_memberships', `select=id,position,jersey_number&player_id=eq.${linked.data}`);
    const [awayPlace] = await db.select('roster_memberships', `select=id&player_id=eq.${awayPlayer.data}`);
    const [match] = await db.insert('matches', [{ home_team_id: home.id, away_team_id: away.id, season_id: season.id, status: 'scheduled', date: new Date(Date.now() + 2 * 86400000).toISOString() }]);
    made.matches.push(match.id);
    await db.insert('scorer_assignments', [{ user_id: who.scorer.id, match_id: match.id }]);

    // ---- G1 Division and season public data -------------------------------------------------------------------------
    log('G1');
    const health = await site('/api/health');
    C('G1', 'GET /health', 'health answers for the target', health.status === 200 && health.body?.environment === target.environment, health.body);
    const version = await site('/version.json');
    const dash = await site('/api/home/dashboard?division=super-league');
    C('G1', 'GET /home/dashboard', 'dashboard: scoped aggregate with its consumed keys', dash.status === 200 && dash.body?.data?.scope?.division?.slug === 'super-league'
      && ['standings', 'news', 'fantasyTop'].every((k) => Array.isArray(dash.body.data[k])) && ['topScorer', 'topAssist', 'liveMatch'].every((k) => k in dash.body.data), { status: dash.status });
    const dashMissing = await site('/api/home/dashboard?division=no-such-division');
    C('G1', 'GET /home/dashboard', 'dashboard: unknown division is 404 JSON', dashMissing.status === 404 && dashMissing.body?.success === false);
    const anon = db.as(null);
    const divs = await anon('/rest/v1/divisions?select=id,slug&slug=eq.super-league');
    const seas = await anon(`/rest/v1/seasons?select=id&division_id=eq.${season.division_id}&is_current=eq.true`);
    C('G1', 'direct divisions+seasons', 'a visitor reads the division and its current season', divs.status === 200 && divs.data?.length === 1 && seas.data?.[0]?.id === season.id);

    // ---- G2 Fixtures, results, standings ----------------------------------------------------------------------------
    log('G2');
    const sched = await site('/api/schedule?division=super-league&limit=100');
    C('G2', 'GET /schedule', 'schedule lists the upcoming fixture with paging', sched.status === 200 && sched.body?.data?.some((m) => m.id === match.id) && sched.body?.meta !== undefined, { status: sched.status });
    const table = await site('/api/standings?division=super-league');
    C('G2', 'GET /standings', 'standings include the season entries and the bracket input', table.status === 200 && table.body?.data?.standings?.some((t) => t.teamId === home.id) && Array.isArray(table.body?.data?.bracketMatches), { status: table.status });
    const teamMatches = await site(`/api/teams/${home.id}/matches`);
    C('G2', 'GET /teams/:team_id/matches', "a team's fixtures include its match", teamMatches.status === 200 && JSON.stringify(teamMatches.body?.data ?? '').includes(match.id), { status: teamMatches.status });
    const dm = await anon(`/rest/v1/matches?select=id,status&id=eq.${match.id}`);
    const de = await anon(`/rest/v1/match_events?select=id&match_id=eq.${match.id}`);
    C('G2', 'direct matches+match_events', 'a visitor reads the match and its (empty) timeline', dm.data?.[0]?.status === 'scheduled' && Array.isArray(de.data));

    // ---- G3 Teams and players ---------------------------------------------------------------------------------------
    log('G3');
    const seasonTeams = await site('/api/teams?division=super-league');
    const allTeams = await site('/api/teams?all=1');
    C('G3', 'GET /teams', 'season teams and the all-teams mode include the entered team', seasonTeams.status === 200 && seasonTeams.body?.data?.some((t) => t.id === home.id) && allTeams.body?.data?.some((t) => t.id === home.id), { status: seasonTeams.status });
    const roster = await site(`/api/players?division=super-league&team_id=${home.id}`);
    C('G3', 'GET /players', 'the season roster lists the rostered player', roster.status === 200 && JSON.stringify(roster.body?.data ?? '').includes(linked.data), { status: roster.status });
    const card = await site(`/api/players/${linked.data}`);
    const cardBad = await site('/api/players/not-a-uuid');
    const cardUnknown = await site('/api/players/00000000-0000-4000-8000-000000000000');
    C('G3', 'GET /players/:player_id', 'a player card answers; malformed and unknown ids are 404', card.status === 200 && cardBad.status === 404 && cardUnknown.status === 404, { card: card.status, malformed: cardBad.status, unknown: cardUnknown.status });
    const lb = await site('/api/leaderboard?division=super-league');
    C('G3', 'GET /leaderboard', 'season scorers and assisters', lb.status === 200 && Array.isArray(lb.body?.data?.topScorers) && Array.isArray(lb.body?.data?.topAssists));
    const de1 = await anon(`/rest/v1/team_entries?select=id&id=eq.${homeEntry.id}`);
    const dr = await anon(`/rest/v1/roster_memberships?select=id&team_entry_id=eq.${homeEntry.id}`);
    const dp = await anon(`/rest/v1/players?select=id,first_name&id=eq.${linked.data}`);
    C('G3', 'direct team_entries+roster+players', 'a visitor reads the entry, its roster and the public card', de1.data?.length === 1 && dr.data?.length === 1 && dp.data?.length === 1);

    // ---- G4 Accounts and profile ------------------------------------------------------------------------------------
    log('G4');
    const flairOwn = await site('/api/wc/flair', { token: who.normal.token, method: 'PATCH', json: { user_id: who.normal.id, wc_team_flair: 'Spain' } });
    const flairOther = await site('/api/wc/flair', { token: who.normal.token, method: 'PATCH', json: { user_id: who.editor.id, wc_team_flair: 'Brazil' } });
    const flairAnon = await site('/api/wc/flair', { method: 'PATCH', json: { user_id: who.normal.id, wc_team_flair: 'Brazil' } });
    const [editorProfile] = await db.select('user_profiles', `select=wc_team_flair&id=eq.${who.editor.id}`);
    C('G4', 'PATCH /wc/flair', 'own flair 200; another user 403; visitor 401; the other row unchanged', flairOwn.status === 200 && flairOther.status === 403 && flairAnon.status === 401 && editorProfile?.wc_team_flair !== 'Brazil', { own: flairOwn.status, other: flairOther.status, anon: flairAnon.status });
    const asNormal = db.as(who.normal.token);
    await asNormal(`/rest/v1/user_profiles?id=eq.${who.normal.id}`, { method: 'PATCH', body: JSON.stringify({ nickname: `n-${tag}`.slice(0, 20) }) });
    await asNormal(`/rest/v1/user_profiles?id=eq.${who.editor.id}`, { method: 'PATCH', body: JSON.stringify({ nickname: 'hijacked' }) });
    const [mine] = await db.select('user_profiles', `select=nickname&id=eq.${who.normal.id}`);
    const [theirs] = await db.select('user_profiles', `select=nickname&id=eq.${who.editor.id}`);
    C('G4', 'direct user_profiles', 'a user changes their own nickname and not someone else\'s', mine?.nickname === `n-${tag}`.slice(0, 20) && theirs?.nickname !== 'hijacked');
    const flOwn = await asNormal('/rest/v1/division_flairs', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: who.normal.id, division_id: season.division_id, team_name: home.name }) });
    const flOther = await asNormal('/rest/v1/division_flairs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: who.editor.id, division_id: season.division_id, team_name: home.name }) });
    const otherFlairs = await db.select('division_flairs', `select=user_id&user_id=eq.${who.editor.id}`);
    C('G4', 'direct division_flairs', 'own division flair saved; another user\'s refused', flOwn.status < 300 && flOther.status >= 400 && otherFlairs.length === 0, { own: flOwn.status, other: flOther.status });
    const asPlayer = db.as(who.player.token);
    const myCard = await asPlayer('/rest/v1/rpc/my_player', { method: 'POST', body: '{}' });
    const notMine = await asNormal('/rest/v1/rpc/my_player', { method: 'POST', body: '{}' });
    const foot = await asPlayer('/rest/v1/rpc/update_my_player', { method: 'POST', body: JSON.stringify({ p_image_url: null, p_preferred_foot: 'Left' }) });
    const footNormal = await asNormal('/rest/v1/rpc/update_my_player', { method: 'POST', body: JSON.stringify({ p_image_url: null, p_preferred_foot: 'Left' }) });
    const myCardAfter = await asPlayer('/rest/v1/rpc/my_player', { method: 'POST', body: '{}' });
    C('G4', 'direct my_player+update_my_player', 'a linked player reads and edits their own card; an unlinked account has none and cannot edit', JSON.stringify(myCard.data ?? '').includes(linked.data) && !JSON.stringify(notMine.data ?? '').includes(linked.data)
      && foot.status < 300 && footNormal.status >= 400 && JSON.stringify(myCardAfter.data ?? '').includes('"Left"'), { update: foot.status, unlinked: footNormal.status });

    // ---- G5 Division predictions (before kickoff) ----------------------------------------------------------------------
    log('G5');
    const prediction = { predicted_home_score: 1, predicted_away_score: 0, predicted_scorers: [linked.data], predicted_assists: [] };
    const pAnon = await site(`/api/predictions/${match.id}`, { method: 'POST', json: prediction });
    const pOwn = await site(`/api/predictions/${match.id}`, { token: who.normal.token, method: 'POST', json: prediction });
    const pAgain = await site(`/api/predictions/${match.id}`, { token: who.normal.token, method: 'POST', json: prediction });
    const pCount = await db.count('predictions', `match_id=eq.${match.id}`);
    C('G5', 'POST /predictions/:match_id', 'a fan predicts once (200, pending); a repeat is 400; a visitor 401; one row stored', pAnon.status === 401 && pOwn.status === 200 && pOwn.body?.data?.status === 'pending' && pAgain.status === 400 && pCount === 1, { anon: pAnon.status, own: pOwn.status, repeat: pAgain.status, rows: pCount });
    const pGet = await site(`/api/predictions/${match.id}`, { token: who.normal.token });
    const pGetAnon = await site(`/api/predictions/${match.id}`);
    C('G5', 'GET /predictions/:match_id', 'the fan sees their prediction; a visitor 401', pGet.status === 200 && pGet.body?.has_predicted === true && pGetAnon.status === 401);

    // ---- G6 Scoped match and roster writes ----------------------------------------------------------------------------
    log('G6');
    const live = (token, extra) => site('/api/admin/matches/live', { token, method: 'POST', json: { match_id: match.id, ...extra } });
    const goal = { action: 'score_step', side: 'home', delta: 1 };
    const lAnon = await live(null, goal);
    const lLoose = await live(who.loose.token, goal);
    const lCaptain = await live(who.captain.token, goal);
    const eventsBefore = await db.count('match_events', `match_id=eq.${match.id}`);
    const lScorer = await live(who.scorer.token, goal);
    const [scored] = await db.select('matches', `select=home_score,status&id=eq.${match.id}`);
    const events = await db.select('match_events', `select=id&match_id=eq.${match.id}`);
    const eventAudit = events[0] ? await db.select('audit_log', `select=actor_id&table_name=eq.match_events&record_id=eq.${events[0].id}`) : [];
    const lClose = await live(who.scorer.token, { action: 'close_match' });
    const [closed] = await db.select('matches', `select=status&id=eq.${match.id}`);
    C('G6', 'POST /admin/matches/live', 'only the assigned scorer records the goal (audited as them) and closes the match; others refused with nothing stored',
      lAnon.status === 401 && lLoose.status === 403 && lCaptain.status === 403 && eventsBefore === 0 && lScorer.status === 200 && scored?.home_score === 1 && events.length === 1
      && eventAudit.some((a) => a.actor_id === who.scorer.id) && lClose.status === 200 && closed?.status === 'completed',
      { anon: lAnon.status, unassigned: lLoose.status, captain: lCaptain.status, scorer: lScorer.status, close: lClose.status, status: closed?.status });

    const listD = await site('/api/admin/matches?division=super-league', { token: who.dictator.token });
    const listS = await site('/api/admin/matches?division=super-league', { token: who.scorer.token });
    const listN = await site('/api/admin/matches?division=super-league', { token: who.normal.token });
    const listA = await site('/api/admin/matches?division=super-league');
    C('G6', 'GET /admin/matches', 'dictator sees the season; the scorer only their match; a normal user none; a visitor 401',
      listD.status === 200 && listD.body?.data?.some((m) => m.id === match.id) && listS.status === 200 && listS.body?.data?.length === 1 && listS.body.data[0].id === match.id
      && listN.status === 200 && listN.body?.data?.length === 0 && listA.status === 401, { dictator: listD.body?.data?.length, scorer: listS.body?.data?.length, normal: listN.body?.data?.length, anon: listA.status });

    const newMatch = { division: 'super-league', home_team_id: home.id, away_team_id: away.id, date: new Date(Date.now() + 5 * 86400000).toISOString(), venue: 'Parity Field' };
    const seasonCount = () => db.count('matches', `season_id=eq.${season.id}`);
    const before = await seasonCount();
    const cNormal = await site('/api/admin/matches', { token: who.normal.token, method: 'POST', json: newMatch });
    const cAnon = await site('/api/admin/matches', { method: 'POST', json: newMatch });
    const between = await seasonCount();
    const cDict = await site('/api/admin/matches', { token: who.dictator.token, method: 'POST', json: newMatch });
    const createdId = cDict.body?.data?.id;
    if (createdId) made.matches.push(createdId);
    const createAudit = createdId ? await db.select('audit_log', `select=actor_id,action&table_name=eq.matches&record_id=eq.${createdId}`) : [];
    C('G6', 'POST /admin/matches', 'a dictator schedules a match (audited as them); a normal user 403 and a visitor 401 store nothing',
      cNormal.status === 403 && cAnon.status === 401 && before === between && cDict.status === 200 && createAudit.some((a) => a.actor_id === who.dictator.id && a.action === 'insert'), { normal: cNormal.status, anon: cAnon.status, dictator: cDict.status });

    const move = { id: createdId, home_team_id: home.id, away_team_id: away.id, date: newMatch.date, venue: 'Moved Ground' };
    const uNormal = await site('/api/admin/matches', { token: who.normal.token, method: 'PUT', json: { ...move, venue: 'Hijacked' } });
    const [afterNormal] = await db.select('matches', `select=venue&id=eq.${createdId}`);
    const uDict = await site('/api/admin/matches', { token: who.dictator.token, method: 'PUT', json: move });
    const [afterDict] = await db.select('matches', `select=venue&id=eq.${createdId}`);
    C('G6', 'PUT /admin/matches', 'a dictator reschedules; a normal user is refused and the match is unchanged', uNormal.status >= 400 && uNormal.status < 500 && afterNormal?.venue === 'Parity Field' && uDict.status === 200 && afterDict?.venue === 'Moved Ground', { normal: uNormal.status, dictator: uDict.status });

    const dNormal = await site(`/api/admin/matches?id=${createdId}`, { token: who.normal.token, method: 'DELETE' });
    const stillThere = (await db.select('matches', `select=id&id=eq.${createdId}`)).length === 1;
    const dDict = await site(`/api/admin/matches?id=${createdId}`, { token: who.dictator.token, method: 'DELETE' });
    const gone = (await db.select('matches', `select=id&id=eq.${createdId}`)).length === 0;
    C('G6', 'DELETE /admin/matches', 'a normal user cannot delete the match; a dictator can', stillThere && dDict.status === 200 && gone, { normal: dNormal.status, dictator: dDict.status });

    const brand = (token, color, extra = {}) => {
      const f = new FormData();
      f.set('team_color', color);
      for (const [k, v] of Object.entries(extra)) f.set(k, v);
      return site('/api/captain/team-branding', { token, method: 'POST', form: f });
    };
    const bNormal = await brand(who.normal.token, '#abcdef', { team_entry_id: homeEntry.id });
    const bAnon = await brand(null, '#abcdef');
    const bCaptain = await brand(who.captain.token, '#123456');
    const [branded] = await db.select('teams', `select=team_color&id=eq.${home.id}`);
    const brandAudit = await db.select('audit_log', `select=actor_id&table_name=eq.teams&record_id=eq.${home.id}`);
    C('G6', 'POST /captain/team-branding', 'the captain changes their team colour (audited as them); a normal user 403; a visitor 401',
      bNormal.status === 403 && bAnon.status === 401 && bCaptain.status === 200 && branded?.team_color === '#123456' && brandAudit.some((a) => a.actor_id === who.captain.id), { normal: bNormal.status, anon: bAnon.status, captain: bCaptain.status });

    const [cardRow] = await db.select('players', `select=attributes,overall_rating&id=eq.${linked.data}`);
    const rosterArgs = (membership) => ({ p_membership_id: membership, p_position: homePlace.position, p_jersey_number: 11, p_overall_rating: 80, p_attributes: cardRow?.attributes ?? {}, p_image_url: null });
    const asCaptain = db.as(who.captain.token);
    const rCaptain = await asCaptain('/rest/v1/rpc/captain_update_roster_player', { method: 'POST', body: JSON.stringify(rosterArgs(homePlace.id)) });
    const rOther = await asCaptain('/rest/v1/rpc/captain_update_roster_player', { method: 'POST', body: JSON.stringify(rosterArgs(awayPlace.id)) });
    const rNormal = await asNormal('/rest/v1/rpc/captain_update_roster_player', { method: 'POST', body: JSON.stringify(rosterArgs(homePlace.id)) });
    const [homeAfter] = await db.select('roster_memberships', `select=jersey_number&id=eq.${homePlace.id}`);
    const [awayAfter] = await db.select('roster_memberships', `select=jersey_number&id=eq.${awayPlace.id}`);
    C('G6', 'direct captain_update_roster_player', 'the captain edits their own roster place; another team\'s and a normal user are refused', rCaptain.status < 300 && homeAfter?.jersey_number === 11 && rOther.status >= 400 && rNormal.status >= 400 && awayAfter?.jersey_number === 9,
      { captain: rCaptain.status, otherTeam: rOther.status, normal: rNormal.status });

    // ---- G5 Division predictions (after the result) ----------------------------------------------------------------
    log('G5 grading');
    const gNormal = await site('/api/admin/predictions/grade', { token: who.normal.token, method: 'POST', json: { match_id: match.id } });
    const gDict = await site('/api/admin/predictions/grade', { token: who.dictator.token, method: 'POST', json: { match_id: match.id } });
    const [graded] = await db.select('predictions', `select=status,points_awarded,graded_events_version&match_id=eq.${match.id}`);
    C('G5', 'POST /admin/predictions/grade', 'a dictator grades the match from its events; a normal user 403', gNormal.status === 403 && gDict.status === 200 && graded?.status !== 'pending' && graded?.points_awarded !== null && graded?.graded_events_version !== null, { normal: gNormal.status, dictator: gDict.status, prediction: graded });
    const rgNormal = await site('/api/admin/predictions/regrade-all', { token: who.normal.token, method: 'POST', json: {} });
    const rgDict = await site('/api/admin/predictions/regrade-all', { token: who.dictator.token, method: 'POST', json: {} });
    C('G5', 'POST /admin/predictions/regrade-all', 'a dictator regrades all; a normal user 403', rgNormal.status === 403 && rgDict.status === 200, { normal: rgNormal.status, dictator: rgDict.status });
    const hist = await site('/api/predictions/history?division=super-league', { token: who.normal.token });
    const histAnon = await site('/api/predictions/history?division=super-league');
    C('G5', 'GET /predictions/history', 'the fan sees their graded prediction; a visitor 401', hist.status === 200 && JSON.stringify(hist.body?.data ?? '').includes(match.id) && histAnon.status === 401, { status: hist.status, anon: histAnon.status });
    const plb = await site('/api/predictions/leaderboard?division=super-league');
    C('G5', 'GET /predictions/leaderboard', 'the season fantasy leaderboard', plb.status === 200 && Array.isArray(plb.body?.data?.overall), { status: plb.status });

    // ---- G7 Editorial ----------------------------------------------------------------------------------------------------
    log('G7');
    const article = { title: `${tag} parity article`, summary: 'Parity check', content: [], category: 'Official Editorial' };
    const nNormal = await site('/api/admin/newsletter', { token: who.normal.token, method: 'POST', json: article });
    const nAnon = await site('/api/admin/newsletter', { method: 'POST', json: article });
    const nEditor = await site('/api/admin/newsletter', { token: who.editor.token, method: 'POST', json: article });
    const stored = await db.select('newsletter', `select=id,title&title=eq.${encodeURIComponent(article.title)}`);
    made.news.push(...stored.map((n) => n.id));
    C('G7', 'POST /admin/newsletter', 'an editor publishes; a normal user 403 and a visitor 401 publish nothing', nNormal.status === 403 && nAnon.status === 401 && nEditor.status === 200 && stored.length === 1, { normal: nNormal.status, anon: nAnon.status, editor: nEditor.status, rows: stored.length });
    const listNews = await site('/api/news?limit=50');
    C('G7', 'GET /news', 'the published article is listed, newest first, with paging', listNews.status === 200 && listNews.body?.data?.some((n) => n.title === article.title) && listNews.body?.meta !== undefined);
    const xEditor = await site(`/api/admin/newsletter?id=${stored[0]?.id}`, { token: who.editor.token, method: 'DELETE' });
    const kept = (await db.select('newsletter', `select=id&id=eq.${stored[0]?.id}`)).length === 1;
    const xDict = await site(`/api/admin/newsletter?id=${stored[0]?.id}`, { token: who.dictator.token, method: 'DELETE' });
    const removed = (await db.select('newsletter', `select=id&id=eq.${stored[0]?.id}`)).length === 0;
    C('G7', 'DELETE /admin/newsletter', 'an editor cannot delete (publishing is not deletion); a dictator can', xEditor.status === 403 && kept && xDict.status === 200 && removed, { editor: xEditor.status, dictator: xDict.status });

    // ---- G8 Current uploads -----------------------------------------------------------------------------------------------
    log('G8');
    const upload = (path, token, fields) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return site(path, { token, method: 'POST', form: f }); };
    const niEditor = await upload('/api/admin/newsletter/image', who.editor.token, { image: file(64, 'news.png') });
    const niNormal = await upload('/api/admin/newsletter/image', who.normal.token, { image: file(64, 'news.png') });
    C('G8', 'POST /admin/newsletter/image', 'an editor uploads a news image that is served; a normal user 403', niEditor.status === 200 && await servesPng(niEditor.body?.publicUrl) && niNormal.status === 403, { editor: niEditor.status, normal: niNormal.status });
    const piCaptain = await upload('/api/admin/freshers/player-image', who.captain.token, { membership_id: homePlace.id, image: file(500, 'portrait.png') });
    const piOther = await upload('/api/admin/freshers/player-image', who.captain.token, { membership_id: awayPlace.id, image: file(500, 'portrait.png') });
    const piNormal = await upload('/api/admin/freshers/player-image', who.normal.token, { membership_id: homePlace.id, image: file(500, 'portrait.png') });
    C('G8', 'POST /admin/freshers/player-image', "the captain uploads their player's portrait; another team's and a normal user are refused", piCaptain.status === 200 && await servesPng(piCaptain.body?.imageUrl) && piOther.status === 403 && piNormal.status === 403,
      { captain: piCaptain.status, otherTeam: piOther.status, normal: piNormal.status });
    const logo = await brand(who.captain.token, '#123456', { logo: file(256, 'logo.png') });
    C('G8', 'POST /captain/team-branding (logo)', 'the captain uploads a 256x256 team logo that is served', logo.status === 200 && await servesPng(logo.body?.data?.logo_url), { status: logo.status });
    const ppPlayer = await upload('/api/profile/player-portrait', who.player.token, { image: file(500, 'me.png') });
    const ppNormal = await upload('/api/profile/player-portrait', who.normal.token, { image: file(500, 'me.png') });
    C('G8', 'POST /profile/player-portrait', 'a linked player uploads their own portrait; an account without a player is refused', ppPlayer.status === 200 && await servesPng(ppPlayer.body?.imageUrl) && ppNormal.status >= 400 && ppNormal.status < 500,
      { player: ppPlayer.status, unlinked: ppNormal.status });

    const summary = report.summary();
    const evidence = {
      item: 'SL-032',
      target: target.name,
      mode: previous ? 'restored previous pair' : 'current pair',
      site: target.site,
      release: { site: version.status === 200 ? version.body : null, worker: health.body },
      recordedAt: new Date().toISOString(),
      passed: summary.passed,
      groups: summary.groups,
      unknownOperations: summary.unknownOperations,
      checks: report.checks,
    };
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    for (const [g, s] of Object.entries(summary.groups)) log(`${s.status.toUpperCase().padEnd(4)} ${g} ${Object.entries(s.operations).filter(([, v]) => v !== 'pass').map(([k, v]) => `${k}=${v}`).join(', ')}`);
    process.exitCode = summary.passed ? 0 : 1;
  } finally {
    log('cleanup');
    for (const id of made.matches) await db.remove('matches', `id=eq.${id}`);
    for (const id of made.news) await db.remove('newsletter', `id=eq.${id}`);
    for (const id of made.players) {
      await db.remove('roster_memberships', `player_id=eq.${id}`);
      await db.remove('players', `id=eq.${id}`);
    }
    for (const id of made.entries) await db.remove('team_entries', `id=eq.${id}`);
    for (const id of made.teams) await db.remove('teams', `id=eq.${id}`);
    for (const id of made.users) {
      await db.remove('division_flairs', `user_id=eq.${id}`);
      await db.deleteUser(id);
    }
    await target.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    log(`verify-parity: ${error?.stack ?? error}`);
    process.exit(1);
  });
}
