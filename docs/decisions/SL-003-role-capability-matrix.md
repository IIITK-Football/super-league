# SL-003 — Capability matrix for the four roles

**Status:** Draft for review (Phase 0 decision record). Source for API authorization, RLS, and dashboard access tests (SL-024/025, SL-092).

## Roles

Exactly four: **user** (normal), **captain**, **scorer**, **dictator**. No alias grants another role's powers: legacy `default`→user, `captain`→captain, `dictator`→dictator; **`admin` and `editor` are retired** and must be mapped explicitly by a reviewed data migration (SL-004), never treated as equivalent at runtime. The old UI label "Scorer" on `admin` is not a scorer permission.

## Assignment scope

- Dictator assigns every role. Only a dictator can change `user_roles`.
- **Captain** is scoped to a team entry (team + season). A captain acts only on entries they are assigned to.
- **Scorer** is scoped to assignments (division/season, optionally specific matches); a scorer acts only within them. Dictators are unscoped.
- A person holding multiple roles (e.g. captain of one team, scorer elsewhere) is an open Phase 2 item (backlog §5); scoping above is fixed regardless.

## Matrix

Legend: **R** read, **C** create, **U** update, **D** delete, **own** own rows only, **assigned** within assignment, **—** none. Enforcement: server authorization **and** RLS wherever direct DB access exists.

| Entity / action | Public (anon) | User | Captain | Scorer | Dictator |
|---|---|---|---|---|---|
| Divisions, seasons, phases, config | R (published) | R | R | R | CRUD |
| Teams, team entries | R | R | R; U own-entry details (name logo colour) *if branding is part of captain duty* | R | CRUD |
| Captain/scorer/role assignments, `user_roles` | — | R own role | R own role | R own role | CRUD |
| Players / person identity (add, remove, rename, merge) | R public fields | U own profile fields (where authorized) | **— (no player CRUD)** | R | CRUD |
| Roster membership | R | R | R own team; **no add/remove/rename** | R | CRUD |
| Team details (captain-entered: color, logo, kit, contact) | R | — | U assigned team | — | CRUD |
| Lineup | R after publish | — | C/U for assigned team, from **existing** roster only, until lock | U/lock for assigned matches | CRUD |
| Match (schedule, teams, phase) | R | R | R | R; U schedule fields only if assigned | CRUD |
| Match state (status, minute/timer, score, penalties, final result) | R | R | — | **CRUD assigned (incl. corrections)** | CRUD |
| Match events (goals, own goals, assist/scorer attribution, cards, undo) | R | R | — | **CRUD assigned (incl. later attribution fixes)** | CRUD |
| Standings, stats, leaderboards (derived) | R | R | R | R; triggers recompute only via match edits | Recompute / regrade |
| Division predictions | — | CRUD own (before lock) | CRUD own | CRUD own | R all; regrade |
| World Cup fantasy | R public | CRUD own | CRUD own | CRUD own | R all; admin data & grading |
| Profiles | R public fields | U own | U own | U own | R/U any |
| Registrations / forms / exports | — | C own | C/R own team | — | CRUD, export |
| News/newsletter, polls, home content, share copy | R | R; vote (polls) | R; vote | R; vote | CRUD |
| Media upload | — | own avatar/profile image | assigned team logo | — | all |
| Service credentials, system settings | — | — | — | — | via server only (never browser) |

## Hard boundaries (testable)

1. Scorer grants **nothing** on teams, players, rosters, accounts, roles, division/season config, editorial, or general management.
2. Captain has **no** insert/update/delete on players or roster rows through any route, RPC, or policy; lineup submission selects existing members only.
3. Every scorer/captain write is checked against assignment scope; cross-assignment writes fail.
4. Dictator is required for all configuration, assignments, and role changes.
5. A hidden UI control is never authorization.

## Current-state gaps this resolves (evidence)

- `user_roles_role_check` allows `default, editor, captain, dictator, admin`; `is_role_manager()` treats `admin` as role manager.
- Baseline RLS has `USING (true)`/`WITH CHECK (true)` insert/update/delete for any `authenticated` user on `matches`, `goals`, `teams`, `players`, `newsletter` — so any signed-in user can write today.
- Policy "Admin and Captain all access players" gives captains full player CRUD.
- Overloaded `captain_update_team_member` (7 args) is SECURITY DEFINER with no ownership check.
- `admin`/`editor` string checks appear in 20+ backend/frontend files (e.g. `backend/app/api/admin/*`, `players/*`, `AdminDashboard.jsx`, `RoleWorkspace.jsx`, `ManageRoles.jsx`).

## Open question carried to Phase 2 (not blocking)

Captain team-branding edits (logo/colour) are listed as captain duty because the current `enforce_team_logo_and_color` and `/api/captain/team-branding` require it; if the user prefers branding be dictator-only, remove that cell.
