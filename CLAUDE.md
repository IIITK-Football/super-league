# Claude Project Handoff

## Purpose and working mandate

This is the concise operating brief for Claude Code. The ordered work and acceptance criteria live in the tracked backlog under [`backlog/`](./backlog/README.md) (one file per item; run `pnpm work status`); read the active item and only the directly relevant code before each task. The repository is a functioning but fragmented product that needs a broad architectural and product redesign.

The user wants Claude to implement the entire backlog autonomously with broad engineering freedom, using Claude Code's `opusplan` mode: Opus plans and Sonnet executes. Work sequentially through the dependency-ordered issues and phases, then continue to the next issue without waiting for a new prompt. Iterate until each item's acceptance checks are satisfied. Use tests first where practical, run the relevant grouped tests, inspect the result, fix failures, and repeat. Do not stop after only producing a plan or completing one phase when more authorized work remains. Do not ask for confirmation on routine reversible implementation choices; record reasonable assumptions and continue. If a session or context limit interrupts the work, leave a precise progress checkpoint and resume from it next session. Keep changes reviewable and make a focused atomic local commit on the existing `develop` branch for each completed feature or independently reviewable backlog item (with its tests/docs) after its checks pass, using a readable Conventional Commit message with no backlog or `SL` references (those live under `backlog/` only); do not use per-phase branches and do not batch a phase into one commit. Summarize the phase's commits at each phase boundary. **Standing authorization (owner, 2026-11-17: "I am giving every freedom but it should work"):** push `ready/<name>` branches, open pull requests into `develop`, and merge them once the required `gate` is green; the staging database deploy that a merge to `develop` triggers is part of that. Without asking: routine commits, tests, local database work on port 54322. **Still requires explicit approval:** anything touching `main` or production (merging into `main`, approving the `Database Production` job), GitHub or Supabase settings, credentials, and any hosted action outside the approved workflows. See "Workflow gates".

## Product vocabulary and fixed decisions

- The formal concept is **division**. A **season** is a particular run within a division. Use these terms consistently in new schema, APIs, UI, routes, tests, and documentation; remove legacy naming as the relevant work is implemented.
- One shared division experience must support multiple seasons and configurable sections. Consolidate the existing men's, women's, and Freshers experiences by preserving the useful capabilities of each. The division and season selected determine the content and configuration.
- Divisions are data, not code: a dictator can create and configure any division (e.g. Inter, Pradhva) with its own seasons, features, rules, branding, registration settings, and format, with no code branch, enum, or schema change. The legacy `inter` value is not carried into target data and no Inter division is pre-created.
- Two hosted Supabase projects exist: production (the original) and staging (`super-league-staging`). Hosted database changes happen only through `.github/workflows/db-deploy.yml`: pushes to `develop` deploy to staging with the synthetic seed (GitHub environment `Database Preview`), pushes to `main` deploy migrations only, never the seed, to production (environment `Database Production`, required reviewer). The environments `Preview` and `Production` belong to the Vercel integration and are not used. Production has no migration history: its baseline is marked applied, never run (see `docs/release.md`). Nothing hosted is touched, pushed or deployed without the user's explicit approval at each gate. `freshers_fixtures` is absent from hosted Supabase (owner-verified); its frontend dependency is removed during registration/frontend consolidation (SL-045, SL-091) with final retirement in SL-102.
- Supabase remains the database and authentication system. Do not propose replacing it as part of the Workers migration.
- The frontend remains React/Vite on Cloudflare Pages. The backend target is Hono services on Cloudflare Workers behind a gateway. Determine service boundaries from code and load; do not assume a worker count in advance. A service binding does not by itself solve browser CORS: use same-origin routing or a tested explicit CORS policy.
- Wrangler R2 local emulation and storage redesign come only after the Worker runtime and storage boundary are established. Preserve working media until replacements and a cutover plan are verified.
- World Cup fantasy is a separate page reached through home content. It remains separate from the shared division experience.

## Role and permission model

Use only these five product roles: **normal user**, **captain**, **scorer**, **editor**, and **dictator**. No role implies another, and legacy `admin`/`editor` labels never grant permissions by inference.

- Normal users use public features and their own account and predictions.
- Captains edit their assigned team's details and branding (name, short name, logo, colours), and the permitted FUT/presentation fields of existing players on that team: position, jersey number, overall rating, attributes, play style, and card portrait. They must not create, remove, rename, falsely register, or account-link players, or change protected identity fields such as roll number and email. They may submit lineups using existing players if that capability is part of the final lineup workflow; it must not imply roster ownership. The explicit allow-list is in `docs/decisions/SL-003-role-capability-matrix.md`.
- Scorers can create, edit, correct, and remove all match-related data, including score, status, timer/minute, goals, own goals, scorer/assist attribution, cards, and final result. Scorer access grants no team/roster, player, account, division/season configuration, editorial, or general management powers.
- Editors can create, edit, and publish newsletter content only (no delete, no other editing or management powers).
- Dictators can manage all product data and settings, including divisions, seasons, teams, players, assignments, match data, feature configuration, and user roles.

Enforce these boundaries in server authorization and Supabase RLS wherever direct database access exists. A hidden control is not an authorization rule. The scorer needs a dedicated match workspace. Captains must not receive player CRUD through an old dashboard, RPC, route, or policy.

## Current repository facts

- `frontend/` is a React 18 / Vite application deployed as Cloudflare Pages. It currently has separate `/super-league`, `/wsl`, and `/freshers` routes.
- `backend/` is a Next.js 16 App Router API with division data, predictions, management, media, and World Cup routes. There is no Hono/Workers gateway in the repository yet.
- The Supabase CLI project is in `backend/supabase/`. Local application development uses database port **54322**. Keep this project self-contained and use explicit local CLI commands.
- `backend/supabase/migrations/20261106000000_baseline.sql` is the current baseline; older migrations are in `migrations_legacy/`. `20261106180125_harden_roles_and_rpc.sql` and the root `schema.sql` are empty. The local seed is `backend/supabase/seed.sql`.
- The Phase 0 decision records are in `docs/decisions/` (SL-002 glossary, SL-003 role matrix, SL-004 migration/cutover); local safety is in `docs/local-development.md`.
- The current schema uses division strings but has no first-class division/season configuration model. Match event data overlaps between JSON columns and `goals`; player identity is team-bound; Freshers also has a separate registration roster.
- Current role values include legacy `default`, `editor`, `captain`, `dictator`, and `admin`; the UI labels `admin` as “Scorer” even though its permissions are broad. Replace these safely with the five-role model: `editor` stays editor (newsletter-only); legacy `admin` is never auto-promoted and needs a reviewed per-person assignment before migration.
- There are no first-class card events, lineups, editable bracket mapping, or reusable account-linked player identity in the baseline.
- R2 configuration is scattered across API routes, media helpers, frontend, middleware, and docs. There is no Wrangler Worker project or local R2 emulation yet.
- `pnpm` is the package manager (each package keeps its own lockfile); environment examples exist for the frontend, backend and Pages Functions.
- Workflows: `ci.yml` (the required `gate` check), `db-deploy.yml` (the only path to hosted databases), and `og-screenshots.yml` (currently failing on the Ubuntu 26.04 / Playwright mismatch, tracked as SL-100; never a required check). The tracked test suite is organised in test groups (`tests/groups.json`). CODEOWNERS is still absent (SL-081).
- The user reports the tablet navigation issue and poor visual quality. Reproduce and verify these during the final frontend phase rather than claiming the repo-only review verified them visually.

## Main product outcomes

1. A shared division-and-season experience with the best existing team builder, captain, match, scoring, standings, and fantasy capabilities. The dictator configures available sections and division/season-specific rules instead of code branching.
2. Account-linked player identity reusable across divisions and seasons, with player profile/FUT data and season participation kept in related records. Players can manage their own profile fields where authorized. Captains cannot alter the player roster; dictators can.
3. One reliable match-event model for goals, own goals, assists, cards, corrections, and score state. Scorers can change every match-related field and event, including later attribution fixes.
4. Configurable league-only, knockout-only, or combined formats. Bracket positions map explicitly to matches and remain editable.
5. A distinct World Cup fantasy page, reached from home content.
6. A configurable home page with current-season video presentation, news carousel, share metadata, and later sections.
7. Grouped tests, local-first contribution instructions, safe migration automation, role-specific dashboards, and a complete design system before frontend redesign is considered done.

## Required sequence

Follow the backlog in order. The key dependencies are:

1. Reliable local Supabase setup, deterministic seed, and test foundation.
2. Formal division/season/player/match model and the five-role authorization policy.
3. Hono/Workers gateway and API migration while preserving the existing Pages frontend.
4. Shared division/season, identity, fantasy, and configuration services.
5. Scorer, match events, lineups, brackets, and statistics.
6. Home metadata, sharing, and external schedule/score integration.
7. R2 configuration and Wrangler local emulation only after the Worker and storage boundaries exist.
8. CI, security, migration, and release workflows.
9. Frontend consolidation, design system, responsive fixes, and product redesign. Frontend product work remains last.
10. Separately reviewed production cutover and legacy retirement.

The order is enforced: no item in a later phase can become ready while an earlier phase still has unfinished items (`pnpm work` phase gating).

Do not perform a giant rewrite. Preserve compatibility until replacement behavior passes parity checks. Use grouped tests relevant to the change; add or update tests for every behavior. Continue iterating until acceptance checks pass and inspect the UI in relevant viewports when the active work is frontend. Report concrete evidence and any remaining blocker.

## Safety boundaries

These are also enforced by the Claude Code guard (`.claude/settings.json`, `scripts/work/claude-guard.mjs`) and by CI. If a command is blocked, report it instead of looking for another way to run it.

- All local Supabase development and validation must target this repository's local project on port **54322**. Never use linked/remote Supabase commands during implementation, and never connect to or mutate hosted production.
- Never reset, seed, migrate, or otherwise destructively alter a database unless the target is verified as this project's local database. Do not delete user data or media as a shortcut.
- The separate `superLeagueBackup` Supabase project (port 55322, outside this repo) is off-limits: never inspect, start, stop, reset, prune, or modify its containers, volumes, files, or data. Never stop/prune/delete Docker containers, networks, or volumes; if Docker is unavailable, report the check unresolved rather than repairing it. The Git branch `develop` does not imply a hosted Supabase develop project (none exists).
- Do not deploy, rotate credentials, publish, or run production cutover without explicit user approval. Build and prepare the complete reviewable change first.
- Do not print or commit secrets from `.env*`, Supabase state, CI, or Cloudflare. Private R2 credentials must remain server-side and out of `VITE_*` variables.
- Do not remove existing R2 URLs or media access until replacements and a verified migration/cutover are ready.
- Use `pnpm`; do not suggest `npm` or `nano`.

## Workflow gates

[`docs/process/workflow.md`](./docs/process/workflow.md) describes them. The principle: **everyday work is fast; validation is rigid when a phase is completed.**

- **Every commit and push (seconds):** staged-file safety (env files, keys, secrets), Conventional Commit messages, no fixup/WIP/merge commits, and only `ready/<name>` branches may be pushed. No test suite runs here. Write tests as you go (test first where practical) and run the relevant ones yourself.
- **Starting an item:** `pnpm work start SL-xxx`. Only the order is checked (dependencies, open decisions, no earlier phase still open). No plan approval, test groups or checks are needed to begin.
- **Pull request into `develop`:** the `gate` runs hygiene, backlog records, the audit and the cheap rule that every changed file is mapped to a group that has tests. No test suite.
- **Completing a phase (rigid, slow, once):** `pnpm work phase N --base <commit before the phase began>` checks every item's prerequisites together (test groups and acceptance checks defined, test files exist, the owner's attestations of manual checks), applies the strict test rules to everything the phase changed (every changed file mapped, covered by an active group, and with a changed test), runs **every** test group once, and writes evidence and a walkthrough for each item. Finish the walkthroughs and run it again. The pull request into `main` runs the same full rules and the whole suite in CI.
- **Owner-only:** `pnpm work attest` records the owner's attestation of a manual check (a hosted step); `pnpm work approve` is optional. Merging into `main` and everything hosted are the owner's.
- There is no bypass flag, variable or switch for any of this, and the safety boundaries above are enforced by the guard in `.claude/settings.json`. At the start of a session read this file and `pnpm work status`; state the issue, narrow scope and acceptance checks before editing. If a genuinely blocking product choice remains, make independent progress elsewhere and ask one focused question. Do not start frontend product redesign before its phase.

## Superpowers

Superpowers skills (brainstorming, test-driven development, debugging, code review) are used for method only; they enforce nothing, and the gates above do. Plans and walkthroughs are tracked in `docs/plans/` and `docs/walkthroughs/`, not in git-ignored folders.
