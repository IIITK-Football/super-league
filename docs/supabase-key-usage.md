# Supabase key usage audit

Where each Supabase API key is used and why. The list of files using the **secret key** is enforced by `backend/tests/config/supabase-key-usage.test.ts`: adding a file there is a deliberate, reviewed step. Moving to publishable and secret keys changes **no privilege**; Row Level Security still decides what the publishable key can do.

## Publishable key (low privilege)
- **Browser** (`frontend/src/lib/supabase.js`): the only Supabase client in the frontend. Safe to expose; protected by RLS.
- **Pages Function** (`frontend/functions/_middleware.js`): reads one newsletter row for share previews. Sends the key as `apikey` only.
- **Backend** (about 45 route files, `middleware.ts`, the login route): user-level clients that use the caller's session or run public reads.

## Secret key (bypasses RLS)

| Routes | Authorization and reason |
|---|---|
| `wc/{leaderboard,players}`, `wc/predictions/{awards,groups}` (GET) | Owner-approved D-04 exception (2026-11-26): read-only World Cup archive data from tables with no public read policy (`wc_leaderboard`, `wc_players`, `wc_award_predictions`, `wc_group_predictions`). Example: `GET /api/wc/leaderboard` with the publishable key would return an empty list. |

Fantasy grading no longer uses the secret key (2026-11-26, SL-032). `admin/predictions/{grade,regrade-all}` call `grade_match` and `regrade_all_predictions` as the caller (migration `20261205000002`). The database checks for a dictator and grades in one call. The old secret-key loop made one Worker subrequest per prediction and per match, beyond the Worker's limit for a full regrade on staging.

`wc/teams` and the saved-bracket read of `wc/predictions/knockouts` use the publishable key (their tables are publicly readable; parity is tested). The World Cup submission handlers (`wc/predictions/{groups,awards,knockouts/submit}` POST) no longer touch the database: the deadline passed, so they serve only the refusal, and the old secret-key write that trusted a body `user_id` is gone.

`captain/team-branding` no longer uses the secret key (2026-11-26): it reads and writes through `team_details_for_edit` and `captain_update_team_details` as the caller, which check for a dictator or a writable captain assignment, so the audit history names the person.

Every server client is built by `backend/lib/supabase/clients.ts` (`publicClient`, `requestClient`/`userClient`, `jobClient`); `jobClient` is the only reader of the secret key, and the files that call it are the list above (tested).

The Worker and the flair handler require an authenticated caller for
`PATCH /api/wc/flair`. The handler updates the caller under RLS with the
publishable key. The old World Cup sync and grade routes have been removed.

The public roster, player and statistics routes (`players`, `players/[player_id]`, `leaderboard`) read only public data under RLS with the publishable key (2026-11-18).

The secret key is never used by `middleware.ts`, shared `lib` code, or anything in the frontend (tested).

## Findings to fix in the authorization work (not changed by the key migration)
1. `wc/sync/manual` and `wc/sync/brazil` run with elevated access and no authentication. **Closed (2026-11-20):** the finished tournament's `wc/sync/*`, `wc/grade/*`, `wc/test`, `wc/matches` and `wc/champion-predictors` routes are removed. They had no caller and no schedule, and the API Worker never served them.
2. `wc/predictions/groups` and `wc/predictions/knockouts/submit` trust a **client-supplied `user_id`** while using elevated access; both refuse every write since the World Cup deadline (`2026-06-22`). **`wc/flair` fixed (SL-025):** it identifies the caller from the session token, updates only their own row as them (no secret key) and answers 403 to another `user_id`.
3. Fourteen routes used to fall back to the publishable (formerly anon) key when the elevated key was missing, silently changing their behaviour. They now fail with a clear error naming the variable. Make sure each hosted environment has the secret key set before deploying.
4. `captain_update_team_member` (7-argument) was executable by anonymous callers and checked nothing about the caller. Fixed by migration `20261118000000` (see `release.md`). Related, also fixed: `admin/team-registrations` used to upsert the `captain` role for the assigned user, silently replacing a dictator's or editor's role. It now upgrades only a default or missing role, keeps a dictator as a dictator, and refuses (409, before writing anything) to change an editor or legacy admin. Its caller check still accepts the legacy `admin` label as a dictator; that belongs to the reviewed role migration.

## Removed variables
- `SUPABASE_ANON_KEY` -> `SUPABASE_PUBLISHABLE_KEY`; `SUPABASE_SERVICE_ROLE_KEY` -> `SUPABASE_SECRET_KEY`; `VITE_SUPABASE_ANON_KEY` -> `VITE_SUPABASE_PUBLISHABLE_KEY`.
- `ADMIN_SECRET_KEY`: no code referenced it; remove it from your local env files and any host settings.

## Rollout (owner actions; legacy and new keys work side by side until the legacy keys are disabled)
1. **Local**: rename the variables in your git-ignored env files and use the keys printed by `pnpm exec supabase status`. Verify with `pnpm test:all`.
2. **Staging**: in the staging dashboard (Project Settings -> API Keys) confirm the publishable key and create a **named secret key**; configure your local staging env files; run the checks below.
3. **Production**, in this order, each step your approval:
   1. Dashboard: confirm the publishable key and create a **named secret key**. Legacy keys keep working.
   2. Add the **new** variables to Vercel (backend) and Cloudflare Pages (build variables and Functions variables) while **keeping the old ones**.
   3. Deploy the new code. Rollback is "redeploy the previous build", which still uses the old variables.
   4. Verify (below).
   5. Remove the old variables from Vercel, Pages and your local files.
   6. Only then check whether the legacy keys still show recent use in the dashboard and **disable them last**. Check whether your dashboard lets you re-enable them; if not, treat this step as irreversible.

**Checks with the new keys before disabling legacy keys:** public pages load data and live scores update; password and Google sign-in work; a newsletter share preview resolves (Pages Function); one role-checked write (captain branding or an admin match update) succeeds and an admin grading call works on staging. The Supabase API logs show no new 401 responses. Any 401 after deploying means a variable is missing: fix it before removing anything.
