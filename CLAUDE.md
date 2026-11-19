# Claude Project Handoff

## Purpose and working mandate

This is the concise operating brief for Claude Code. The ordered work and acceptance criteria live in the tracked backlog under [`backlog/`](./backlog/README.md) (one file per item; run `pnpm work status`); read the active item and only the directly relevant code before each task. The repository is a functioning but fragmented product that needs a broad architectural and product redesign.

The user wants Claude to implement the entire backlog autonomously with broad engineering freedom, using Claude Code's `opus` model. Work sequentially through the dependency-ordered issues and phases, then continue to the next issue without waiting for a new prompt. Iterate until each item's acceptance checks are satisfied. Use tests first where practical, run the relevant grouped tests, inspect the result, fix failures, and repeat. Do not stop after only producing a plan or completing one phase when more authorized work remains. Do not ask for confirmation on routine reversible implementation choices; record reasonable assumptions and continue. If a session or context limit interrupts the work, leave a precise progress checkpoint and resume from it next session. Keep changes reviewable and make a focused atomic local commit on the existing `develop` branch for each completed feature or independently reviewable backlog item (with its tests/docs) after its checks pass, using a readable Conventional Commit message with no backlog or `SL` references (those live under `backlog/` only) and **no AI attribution of any kind** (no `Co-Authored-By` trailer for an assistant, no "Generated with" line, in commits or pull request descriptions; the owner is the only author, committing with their own Git identity, and the commit-msg hook and CI hygiene reject anything else); do not use per-phase branches and do not batch a phase into one commit. Summarize the phase's commits at each phase boundary. **Standing authorization (owner, 2026-11-17):** work directly on `develop`, commit there, and push `develop` to origin without asking; the staging database deploy that a push to `develop` triggers (migrations and the synthetic seed, through the approved workflow) is part of that. Routine tests and local database work on port 54322 need no asking. **Still requires explicit approval:** anything touching `main` or production (a pull request into `main`, approving the `Database Production` job), GitHub or Supabase settings, credentials, and any hosted action outside the approved workflows. The two major hurdles are `main` protection and the phase-completion gate; everything else is meant to be fast. See "Workflow gates".

## Product vocabulary and fixed decisions

- The formal concept is **division**. A **season** is a particular run within a division. Use these terms consistently in new schema, APIs, UI, routes, tests, and documentation; remove legacy naming as the relevant work is implemented.
- One shared division experience must support multiple seasons and configurable sections. Consolidate the existing men's, women's, and Freshers experiences by preserving the useful capabilities of each. The division and season selected determine the content and configuration.
- Divisions are data, not code: a dictator can create and configure any division (e.g. Inter, Pradhva) with its own seasons, features, rules, branding, registration settings, and format, with no code branch, enum, or schema change. The legacy `inter` value is not carried into target data and no Inter division is pre-created.
- Two hosted Supabase projects exist: production (the original) and staging (`super-league-staging`). Hosted database changes happen only through `.github/workflows/db-deploy.yml`: the owner's standing authorization permits pushes to `develop` and their staging deploy with the synthetic seed (GitHub environment `Database Preview`); pushes to `main` deploy migrations only, never the seed, to production (environment `Database Production`, required reviewer). The environments `Preview` and `Production` belong to the Vercel integration and are not used. Production has no migration history: its baseline is marked applied, never run (see `docs/release.md`). Any hosted action outside the approved `develop` staging workflow, especially any production action, requires explicit approval. `freshers_fixtures` is absent from hosted Supabase (owner-verified); its unused frontend readers were deleted in SL-020, and the table itself is never recreated.
- Supabase remains the database and authentication system. Do not propose replacing it as part of the Workers migration.
- The frontend remains React/Vite on Cloudflare Pages. The backend target is Hono services on Cloudflare Workers behind a gateway. Determine service boundaries from code and load; do not assume a worker count in advance. A service binding does not by itself solve browser CORS: use same-origin routing or a tested explicit CORS policy.
- Wrangler R2 local emulation and storage redesign come only after the Worker runtime and storage boundary are established. Preserve working media until replacements and a cutover plan are verified.
- World Cup fantasy is a separate page and domain reached through home content. It remains separate from the shared division experience and is not to be folded into division work. Avoid incidental changes to its page, user-visible behavior, or data model; if an active security requirement requires a narrow World Cup backend change, keep it isolated and verify it separately.

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
- Divisions and seasons are first-class records (SL-020): `divisions`, `seasons` (one current per division), `season_sections`, `team_entries`, `division_flairs` and `season_player_stats`; matches and registrations carry `season_id`. The legacy division strings, their views and the unused polls feature are retired (`20261122000000`). The API names a division by slug and a season by slug or id; the frontend routes are `/<division>` and `/<division>/<season>`. Match event data overlaps between JSON columns and `goals`. Players are reusable identities (the FUT card) with one roster place per season (`roster_memberships`, SL-021); the Freshers member table is retired, goals and assists are read only through `season_player_stats`, and captains edit their roster through `captain_update_roster_player`.
- Stored role values are `default`, `editor`, `captain` and `dictator`; SL-024 replaces them with the five roles and scoped assignments (`editor` stays newsletter-only). Owner decision 2026-11-19: legacy `admin` accounts are never ported or promoted. `20261129000000` removed every `admin` privilege (`is_role_manager()` is dictator-only until SL-024), and `20261130000000` sets remaining `admin` rows to `default` (audited; Auth accounts and profiles kept), drops `admin` from the role check and drops `get_user_role()`. `/dictator` is the canonical dashboard URL; `/admin` redirects to it.
- There are no first-class card events, lineups, or editable bracket mapping yet. A player identity can be linked to one verified Auth account (`players.user_id`, SL-042): only a dictator links or unlinks (a trigger refuses every other path, the server key included), the column is unreadable outside the server, and a linked player edits only their own portrait and preferred foot (`my_player`, `update_my_player`). A player has one play style from the catalog (`attributes.playStyle`), or none.
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
7. Grouped tests, local-first contribution instructions, safe migration automation, role-specific dashboards (each first delivered, minimally usable, with the capability it serves), and a complete design system before the frontend redesign is considered done.

## Required sequence

Follow the backlog in order. The key dependencies are:

The unfinished work is organised as **end-to-end feature slices** (restructured 2026-11-18; `backlog/phases.md`, and `backlog/superseded.json` for folded items). Each slice delivers, in its own phase:
- its migration with data-preservation guards;
- its API;
- a minimal usable frontend;
- local and staging verification.

Each slice ports every known caller, then retires the path it replaces.

1. Reliable local Supabase setup, deterministic seed, and test foundation.
2. Canonical domain slices, end to end, on the current API: divisions/seasons (done), player identity and season rosters, audit history, account-linked players, five roles with scoped assignments, canonical match events and statistics; then the security audit and API contracts.
3. Hono/Workers runtime, gateway and parity port, plus the complete R2 storage system after the Worker runtime exists: inventory, abstraction, Wrangler local emulation, bucket/domain reorganization rolled out local → staging → production one bucket at a time, and credential rotation. Later phases consume this storage and never redo its migration.
4. Division/season product capabilities: configuration and navigation, fantasy (World Cup decoupled), rules, registration, exports, sign-in allowlists.
5. Match operations: phone/offline scorer workspace, lineups, formats and brackets.
6. Home configuration, sharing, and external schedule/score integration.
7. (Merged into 3; the phase holds no items.)
8. CI, repository policy, and contributor documentation.
9. Frontend consolidation, design system, responsive fixes, and visual redesign of flows that are already usable from earlier phases. The redesign remains last; first usable flows do not wait for it (see "Usable in its own phase").
10. Separately reviewed production cutover, branded Auth domain, and the final legacy sweep.

The order is enforced: no item in a later phase can become ready while an earlier phase still has unfinished items (`pnpm work` phase gating), and `dependsOn` orders items inside a phase.

### Usable in its own phase

When a product capability is meant to be used or configured by a person (a dictator, captain, scorer, editor, player or visitor), the item and phase that build it also deliver a **minimally usable flow in the existing frontend**. Do not defer the first usable UI to the Phase 9 redesign; Phase 9 consolidates, visually designs and refines flows that already work. The minimal flow follows the current frontend patterns (no redesign), exposes the real authorized action (never a hidden control standing in for authorization), and handles loading, empty, success and error states. Verify the real UI → API → database path with tests (allowed and denied cases), locally and then on staging, as for any other cross-layer behavior. Database or API support alone does not complete such an item. This applies only to user-facing capabilities: backend infrastructure, runtime, storage, security and tooling changes need no arbitrary UI. World Cup fantasy stays a separate page and is not folded into division flows.

Do not perform a giant rewrite. Work in small, coherent increments, completing and checking one backlog item or user-visible behavior before broadening scope. Preserve compatibility until replacement behavior passes parity checks. Avoid speculative abstractions and duplicate sources of truth; where temporary duplication is necessary for compatibility, identify the authoritative writer and add checks for drift.

For behavior that crosses layers, verify the real path end to end: the database state and constraints, the authenticated API and authorization rules, and the UI that invokes it, as applicable. Unit tests and mocked routes are useful but do not replace an integration test through the real local service for persistence, authentication, or role-sensitive behavior. Include both allowed and denied cases. Do not mark an item complete because its schema or isolated tests pass if its promised user-facing flow is missing or broken.

Use local-first verification. Apply and test database changes against this repository's local Supabase project on port **54322**, then use the approved `develop` workflow and its staging checks to verify hosted staging behavior. Never connect to or mutate production for routine testing. Preserve existing local data: use the guarded local database helper and reset only when a clean rebuild is needed and local data loss is understood. Never reset staging except for an explicitly authorized staging rebuild.

Treat data preservation as a correctness requirement. Use new forward migrations; do not edit migrations already applied to any shared environment. Make backfills repeatable and transactional where possible, and verify preserved row counts, identities, relationships, and historical results before considering a migration complete. Avoid cascades or synchronization triggers that can erase history or create competing writers. Prefer one authoritative source for each fact, and defer contract/drop work until replacement behavior has passed parity checks. Optimize SQL from measured query plans and realistic usage; add indexes for demonstrated access patterns rather than speculative cleanup. Continue iterating until acceptance checks pass, inspect the UI in relevant viewports when the active work is frontend, and report concrete evidence and remaining blockers.

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

- **Every commit and push to `develop` (seconds):** staged-file safety (env files, keys, secrets), Conventional Commit messages, no fixup/WIP/merge commits, no force push, no branch deletion. No test suite runs here, and no branch or pull request is needed. Write tests as you go (test first where practical) and run the relevant ones yourself.
- **Starting an item:** `pnpm work start SL-xxx`. Only the order is checked (dependencies, open decisions, no earlier phase still open). No plan approval, test groups or checks are needed to begin.
- **Pushes to `develop`** also run a light CI pass for visibility (hygiene, backlog records, the audit and the cheap mapped-and-covered rule); it is not a merge requirement.
- **Completing a phase (rigid, slow, once):** `pnpm work phase N --base <commit before the phase began>` checks every item's prerequisites together (test groups and acceptance checks defined, test files exist, the owner's attestations of manual checks), applies the strict test rules to everything the phase changed (every changed file mapped, covered by an active group, and with a changed test), runs **every** test group once, and writes evidence and a walkthrough for each item. Finish the walkthroughs and run it again. `main` is protected: it is reached only by a pull request, which must pass the required `gate` running the same full rules and the whole suite, and the owner approves the production database job.
- **Owner-only:** `pnpm work attest` records the owner's attestation of a manual check (a hosted step). It is the owner's statement, so when the agent runs it the owner gets a confirmation prompt, and the agent attests only what the recorded evidence supports; `pnpm work approve` is optional and stays the owner's. Anything touching `main`, production or GitHub and Supabase settings is the owner's.
- There is no bypass flag, variable or switch for any of this, and the safety boundaries above are enforced by the guard in `.claude/settings.json`. At the start of a session read this file and `pnpm work status`; state the issue, narrow scope and acceptance checks before editing. If a genuinely blocking product choice remains, make independent progress elsewhere and ask one focused question. Do not start the Phase 9 consolidation and visual redesign before its phase; the first usable flow of a capability belongs to the capability's own item.

## Plans, walkthroughs and plugins

Do not install, enable or invoke the Superpowers plugin or any of its skills (`superpowers:*`) in this project; the workflow is defined only by this file, `docs/process/workflow.md` and the `pnpm work` gates. Plans and walkthroughs are tracked in `docs/plans/` and `docs/walkthroughs/`, not in git-ignored folders.
