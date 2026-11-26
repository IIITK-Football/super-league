# Current checkpoint

The live relay checkpoint shared by Claude (main checkout, `develop`) and Codex (`../super-league-codex`,
`codex/work`). The agent that stops rewrites this file last, after committing its work. See `AGENTS.md` for the
handoff steps.

## Status

- **Updated:** 2026-11-26 by Claude.
- **Active item:** SL-030 (Phase 3), started with `pnpm work start` in `5e89361`.
- **Plan:** `docs/plans/SL-030.md` and the approved session plan summarized below. Decisions D-04 and D-05.
- **Owner answers (2026-11-26):**
  - World Cup secret-key reads: downscope where row-level security gives the same response; list any that cannot as owner exceptions.
  - Staging: Claude makes the read-only GETs on staging; the owner switches Smart Placement on or off when asked and attests C3.

## Done

- `fdb78b3`: client factories in `backend/lib/supabase/clients.ts`:
  - `publicClient`, `requestClient`/`userClient` and `jobClient`, the only reader of `secretKey()`;
  - 8 s and 20 s timeouts, one retry for GET or HEAD only on a network error;
  - per-request round counting through `AsyncLocalStorage`, and a `Server-Timing` header set in `api/src/app.ts`.

  Every handler the Worker serves now builds its clients through the factories (tested in `supabase-key-usage.test.ts`). Scope resolution takes one round. The dashboard takes 3 rounds, down from 11 (`api/test/rounds.test.ts`). Prediction submission now forwards the caller's token. Unit tests and both `tsc` checks pass, and `wrangler deploy --dry-run` builds.
- **Not yet run:** the database-backed groups. Docker (Colima) was down; the project rules say not to start it.

## Exact next step

1. Owner starts Docker (`colima start`), then `pnpm db:check` (port 54322).
2. Run `pnpm test:group api-services config divisions auth-roles audit`. The shared `resolveScope` changed (season and division in one query), so check the divisions group closely. Fix any failures.
3. **Step 3, captain branding.** Add a migration with `captain_update_team_details(p_entry, p_name, p_short_name, p_color, p_logo_url)`:
   - `SECURITY DEFINER` with an empty `search_path`;
   - an `auth.uid()` check, plus `is_captain_of(p_entry) OR is_dictator()`.

   Switch `backend/app/api/captain/team-branding/route.ts` from `jobClient` to the RPC through `requestClient`. Remove it from the secret-key allowlist in `supabase-key-usage.test.ts` and `docs/supabase-key-usage.md`.

   Integration tests:
   - the audit actor is recorded for a captain and for a dictator;
   - another team's captain, a scorer and a plain user are refused, with the row unchanged;
   - the logo cleanup still runs on failure.
4. **Step 4, World Cup reads.** The routes in `wc/**` currently call `jobClient()`. Run a parity test of each against the seed with the secret key versus the publishable key or caller token, and downscope the ones that match. The submit routes should use the session caller instead of a body `user_id`.
5. **Step 6, real Wrangler evidence.** Add `api/scripts/verify-local-worker.mjs` with JSON evidence. It covers:
   - health;
   - a scoped read;
   - missing, expired (HS256 signed with the local default secret), tampered and valid tokens, with rows unchanged on denial;
   - the dictator audit actor;
   - rollback of an induced failure in a multi-write RPC;
   - `Server-Timing`;
   - a non-local URL refused with 503.

   Mirror the checks in `api/test/security.test.ts`.
6. **Step 7, bundle scan.** Build the frontend and run `wrangler deploy --dry-run --outdir`. Scan both outputs for secret names and value formats.
7. **Steps 8 and 9.**
   - Docs: the D-04 compliance table in `docs/plans/SL-030.md`, the key-usage doc and the walkthrough `docs/walkthroughs/SL-030.md`.
   - Push `develop`, then collect the staging evidence: build ID and commit, health, a scoped read through the Pages URL, timings, and the Smart Placement on/off comparison.

## In flight

Nothing uncommitted.

## Local database

Not running (Docker down). There are no new migrations yet.

## Not migrated on purpose

`auth/login`, `legends` and `admin/teams` still build clients directly. The Worker does not serve them; they are Next-only and are retired by SL-034.

## Contributor prototypes to read when their item comes up

- #185 → SL-050 phone scorer.
- #186 → SL-053 lineups.
- #187 → SL-090 design system.

## Order after SL-030

1. SL-031 → SL-032.
2. SL-040 → SL-044.
3. SL-045.
4. SL-050, SL-054.
5. SL-053, SL-108.
6. Phase 8: SL-104, SL-043, storage (SL-070 → SL-071 → SL-105 → SL-072 → SL-106), SL-060, SL-061.
7. Phase 9, then Phase 10.
