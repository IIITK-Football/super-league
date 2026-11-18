# Super League Website — Ordered Architectural Backlog

**Purpose:** Record the issues, desired outcomes, dependencies, and completion checks for the full website redesign. This is a planning document, not an instruction to execute every item at once. Items are deliberately ordered so local workflows and domain/security decisions precede a backend migration, Workers precede Wrangler R2 emulation, and the frontend consolidation and visual redesign is last. Each user-facing capability nevertheless ships a minimally usable flow in the existing frontend in its own phase (rule R10).

**Status convention:** All items are currently `Not started`. Mark an item complete only after the stated result is implemented and verified. Create small atomic commits for each reviewable feature or tightly related migration.

## 1. Repository diagnosis

This is the code-based starting point observed during repository review on 15 November 2026. User-reported appearance problems are identified as reports and are not presented as visually reproduced results.

### 1.1 Application boundaries

- `frontend/` is a React/Vite application with Cloudflare Pages configuration. Its routes still distinguish `/super-league`, `/wsl`, and `/freshers`; `LeagueContext` stores the division but no selected season identity. `Home.jsx`, `Standings.jsx`, `Fantasy.jsx`, `Teams.jsx`, and related components contain division-specific choices and presentation.
- `backend/` is a Next.js 16 App Router application containing public API, account, administration, prediction, media-proxy, and World Cup functionality. The routes are organized under `backend/app/api/`, with World Cup behavior split across many `/wc/*` endpoints.
- The frontend's `API_BASE_URL` can point at a configured API URL or use `/api`. There is no checked-in Hono/Workers API, gateway, Wrangler configuration, or defined service-binding topology.
- Frontend components also create Supabase Auth/Data API clients and directly read or write profiles, roles, and other records. This leaves access paths split between browser-to-Supabase and browser-to-Next routes; the target gateway/API contract must inventory each direct call and define which are safe to keep.
- The existing Pages Functions middleware rewrites Open Graph metadata for articles and hard-codes match-page descriptions and a public R2 image host. The screenshot workflow also assumes the current frontend can be captured through a set of paths, some of which no longer match the route table.

### 1.2 Data and behavior split

- The current baseline has 20 public tables, 3 views, 10 functions, and 44 policies. It stored a division string on teams, matches, registrations, and polls (retired in SL-020, replaced by `divisions`, `seasons` and `team_entries`), but had no canonical `divisions` or `seasons` records and no configurable page/feature model.
- The current schema holds match scorers/assists/own goals in JSON fields and also records goals in a separate `goals` table. These parallel representations can disagree and make score/stat/fantasy calculations harder to trust.
- `players` are associated directly with a team. Freshers also has a separate `team_members` registration roster. There is no single account-linked player identity that persists across teams, divisions, and seasons.
- The schema has no first-class match card events, team lineups/starting positions, bracket-to-match mappings, or division-level home presentation settings.
- General user profile fields currently include division/team flair fields, including World Cup-specific flair, rather than isolating allegiance/preferences to a division fantasy profile.
- The archived migration `030_freshers_road_to_final.sql` is the only migration in the tracked migration directories that creates `freshers_fixtures`. The current baseline does not create it; `RoadToFinal.jsx` and `ManageRoadToFinal.jsx` still query that legacy table. This is a fragile special case that should be retired in favor of the canonical fixture/match model.
- The current seed is substantial and has sample data across the existing schema, but does not add missing domain concepts. Its stock image URLs are remote URLs, so a database reset does not alone produce an offline media environment. Seed completeness, row volumes, and fresh-reset behavior still need repeatable validation.
- `backend/README.md` still instructs contributors to apply `030_freshers_road_to_final.sql` and `035_team_branding.sql` directly, even though those migrations are under `migrations_legacy/` and the current migration chain is the baseline. This makes the documented database state disagree with the active local setup.
- The root `schema.sql` is empty. The active baseline is under `backend/supabase/migrations/`, so there is no meaningful root schema file to use as an alternative source of truth.

### 1.3 Authorization and operational risks

- The database role check accepts `default`, `editor`, `captain`, `dictator`, and `admin`. In `ManageRoles.jsx`, the `admin` value is labeled “Scorer”; this is a label applied to the broad admin role, not a scorer-specific permission model.
- The admin dashboard admits `admin` and `dictator` users and gives access to broad management tabs. `RoleWorkspace.jsx` also treats `admin` as dictator-level for relevant routes. This does not meet the requirement that a scorer can change every match detail but nothing outside match operations.
- Baseline RLS includes broad authenticated `INSERT`, `UPDATE`, and `DELETE` policies on matches, goals, teams, players, and newsletter data. Application checks in individual API routes cannot make those direct database policies safe. Several policies overlap, so effective permissions require a deliberate audit and tests.
- The two-argument and extended `captain_update_team_member` security-definer functions have different authorization behavior; the extended form updates a member by ID without the same visible captain-to-registration ownership check. This needs explicit security review before retaining either overload.
- API modules create Supabase clients and perform role checks independently. Some server routes use a service-role key or fall back between server keys. The future service boundary needs one explicit authentication/authorization model and must keep privileged credentials server-only.
- The user reports that the application now uses local Supabase. The repository has a local Supabase CLI config and seed, but no complete backend `.env.example` or enforced local-only workflow. The application development database uses port `54322`.
- Both `pnpm-lock.yaml` and `package-lock.json` are tracked in the frontend and backend, and a root package/lockfile also exists. The root package has no workspace scripts, and there is no tracked pnpm workspace definition. This leaves install ownership unclear even though the user uses `pnpm`.
- The checked-in frontend environment template includes a demo password variable. A `VITE_*` value is exposed to browser code and cannot be treated as a private secret; active demo credentials must be assessed and kept out of public bundles.

### 1.4 Media, homepage, and delivery

- R2 endpoint/client construction is spread across `backend/lib/r2.ts`, API upload routes, the media proxy, `frontend/src/pages/LeagueLanding.jsx`, `frontend/src/data/playStyles.js`, `frontend/functions/_middleware.js`, and `backend/README.md`. The documented variable names and bucket-specific public hosts are not represented by one typed storage configuration. Seed image URLs use remote stock hosts and also do not provide offline assets.
- `LeagueLanding.jsx` currently defines three division entries, three clip identifiers per division, poster URLs, and carousel ordering in source. It uses two HLS/video slots to preload clips. This is not the requested configurable, chapter-oriented single HLS presentation.
- The home page currently presents a bento-style data dashboard, division-specific standings/road-to-final blocks, and a news grid. It displays an “Aggregating Live Data...” spinner while waiting. The requested sliding news/home presentation and calmer loader are not implemented.
- Current global profile/onboarding and fantasy navigation couple the World Cup flair and World Cup prediction surface to general account/fantasy routes. The World Cup tables/API exist, so the gap is primarily domain separation and product navigation rather than absence of all World Cup code.
- `Teams.jsx` replaces the team view with a full PlayerProfile view after selection. This is not the requested inline, single-open player-card expansion.
- The user reports that the navbar disappears at tablet aspect ratios and that the visual system is poor. These are explicit frontend backlog items to reproduce and fix in the final phase.

### 1.5 Engineering workflow

- The repository has no tracked application test suite, test-group configuration, pre-commit framework, or `CODEOWNERS` file. The frontend package includes Playwright, but the existing screenshot script is not a feature test suite.
- `.github/workflows/og-screenshots.yml` is the only workflow found. It runs on pushes to both `main` and `develop`, installs with npm, captures production pages, and uploads screenshots to R2. It does not validate database migrations or run grouped tests. The route list includes `/clubs` and `/statistics`, while the current routes use `/teams` and `/leaderboard`.
- No workflow applies Supabase migrations by branch/environment. The contributor documentation describes Next.js/Vercel and uses generic package-manager choices; it does not teach the requested `pnpm`, local Supabase CLI, Wrangler, grouped tests, or pre-commit workflow.
- The Playwright/Ubuntu issue is user-reported. The current workflow's runner, Node, Playwright, browser installation, and route set need a reproducible CI diagnosis rather than a blind version change.

## 2. Dependency order

| Phase | Work area | Must precede |
|---|---|---|
| 0 | Scope, data safety, product/domain decisions | All schema and service rewrites |
| 1 | Local-first setup, fixture validation, test/CI foundation | Migration implementation and reliable feature work |
| 2 | Canonical data model, permissions, and API contracts | Workers migration and unified features |
| 3 | Hono/Cloudflare Workers gateway and service migration | Wrangler R2 emulation; new backend feature APIs |
| 4 | Division/season, player, fantasy, and settings backend | Consolidated interface (minimal flows ship with each item) |
| 5 | Match operations, scorer role, lineups, brackets, statistics | Consolidated match/admin interface (minimal flows ship with each item) |
| 6 | Configurable home metadata, sharing, and external data integrations | Consolidated home interface (minimal flows ship with each item) |
| 7 | R2 storage redesign and Wrangler local emulation | Media cutover and final frontend media integration |
| 8 | Migration, security, test, and release automation completion | Production cutover |
| 9 | Full frontend consolidation and design system | User-facing launch |
| 10 | Production cutover and legacy retirement | Completion |

**Hard ordering constraint:** Wrangler R2 emulation is Phase 7 and cannot start until the Worker runtime and storage boundary from Phase 3 are in place. **Frontend constraint:** Do not begin the product redesign or the division UI consolidation until Phases 0–8 are complete. Existing frontend behavior stays compatible while the backend changes. A capability a person uses or configures still ships a minimal, working flow in the existing frontend in its own phase, following current patterns (rule R10); Phase 9 consolidates, redesigns and refines those flows rather than creating them.

## 3. Phased backlog
