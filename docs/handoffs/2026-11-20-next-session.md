# Handoff, 2026-11-20: SL-022 closed, next is SL-025

## State
- Branch `develop`, HEAD `e53fe41` ("chore: complete the match events item"). Pushed to origin and the push succeeded (`ef82bd6..e53fe41`).
- The working tree was NOT re-checked after the last commit. At session start there were untracked files that are not mine: `.github/agents|hooks|skills`, `.pnpm-store`, `supabase/`. The temporary `.sl022-done.log` I created was removed. Run `git status` first.

## Complete (verified)
- SL-022 is done. The final `pnpm work done SL-022 --base ea694ec` printed "SL-022 is done" after running every test group. The evidence file, walkthrough and attestations (C10, C12, C13) are committed.
- Staging: Database deploy run 44726308773 (manual dispatch on `develop` at `ef82bd6`) succeeded. `node scripts/staging-checks.mjs` passed 40 of 40.
- Production-shaped clone: both migrations applied with no guard failures. 113 events, 15 unattributed goals, 3 walkover candidates, scores unchanged, prediction points unchanged at 64080. Recorded in `docs/release.md`.
- The real-app walkthrough passed 12 of 12 steps at served commit `5e04258`.
- The `gh` CLI is logged in as `kevinmatheuu` with the `workflow` scope. Push with `git -c credential.helper= -c credential.helper='!gh auth git-credential' push https://github.com/IIITK-Football/super-league.git develop`.

## Not checked
- CI results for the last pushes (`ecef623`, `b483830`, `e53fe41`). I did not poll.
- No staging deploy ran for commits after `ef82bd6`. They only touch tests, docs and backlog files, which the workflow's path filter ignores.
- The live production site against the new schema.
- The working tree after the last commit, and whether the local servers below are still running.

## Running locally (as of the last time I saw them)
- The local Supabase stack on :54322 is up. It was reset to the clean seed at the end of the last gate run.
- Backend dev server on :3000 and Vite on :5173, both started by me from this checkout. They were never stopped (my kill was rejected). Not re-checked.
- The isolated clone (ports 563xx) is untouched since the rehearsal. It has the two migrations applied and my throwaway `rehearsal_before*` tables.

## Remaining
- Owner: the production release (pull request with a merge commit, verified backup, approve `Database Production`). Afterwards compare `match_event_migration_report` by finding with the clone numbers.
- Next backlog item is SL-025 (security audit). Add the approved `user_profiles` decisions to its plan:
  - column privileges on `email` and `real_name`;
  - a leaderboard username fallback that doesn't use the email prefix;
  - `PATCH /api/wc/flair` authentication.
- Later: SL-043 (`team_flair_id` copy-then-drop, relax the World Cup onboarding gate), then SL-102 (drop `email`).
- The gradient-text design-hook findings (`MatchTimeline.jsx`, `Login.jsx`, `AdminDashboard.jsx`) were left for the Phase 9 redesign; none were suppressed.
- Git author identity is still `oreoruuser`; I left it. Check whether the hooks need updating.

## Exact next action for a fresh session
1. Read `CLAUDE.md` and run `pnpm work status`.
2. Run `git status` and `git log -3`, expecting `e53fe41` on `develop`.
3. Ask the owner to stop the dev servers on :3000 and :5173.
4. Run `pnpm work ready SL-025`, then `pnpm work start SL-025`.
5. Run commands relative to the repo root: no `cd`, no absolute paths, no sibling-directory globs. This is a standing owner preference saved in memory.
