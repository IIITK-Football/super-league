# SL-003 — Capability matrix for the five roles

**Status:** Approved by owner 2026-11-16 (Phase 0 decision record). Source for API authorization, RLS, and dashboard access tests (SL-024/025, SL-092).

> Five distinct roles — **user**, **captain**, **scorer**, **editor**, **dictator** — as approved by the owner. `CLAUDE.md` has been updated to match (it is git-ignored).

## Roles

| Role | Power in one line |
|---|---|
| **user** | Public features and own account/predictions. |
| **captain** | Edits their assigned team's details/branding and permitted presentation fields of *existing* players; submits lineups. |
| **scorer** | Changes all match data and match events. Nothing else. |
| **editor** | Creates, edits, and publishes newsletter content. Nothing else. |
| **dictator** | Manages everything, including divisions, seasons, teams, players, assignments, config, and roles. |

**No role implies another.** No alias: `admin` is not scorer or dictator; `editor` is not a general editor. Each role grants only its row above plus the user baseline.

## Assignment scope

- Only a dictator changes roles and assignments.
- **Captain** is scoped to a team entry (team + season) and acts only there.
- **Scorer** is scoped to assignments (division/season, optionally matches). Dictators are unscoped.
- **Editor** is global to newsletter content (no division scope required).
- Whether one person may hold several roles is an open Phase 2 item (backlog §5); each role's scope above applies regardless.

## Captain: explicit field allow-list

**Team (assigned team entry only):** team name, short name, logo, primary and secondary colours, other branding/presentation fields (e.g. kit/crest description) defined by the team-branding model.

**Existing players on their roster — presentation/FUT only:** position, jersey number, FUT overall rating, FUT attributes/stats display values, play style, card portrait/image.

**Never (any route, RPC, policy, or direct DB access):**
- Create, remove, or archive a player or roster membership.
- Rename a player (first/last/display name).
- Falsely register a player, or link/unlink a player to a user account (includes the `email` link field).
- Change protected identity fields: roll number, email, account link, player ID, and team membership.
- Edit players on any team other than their assigned one.

Lineup submission selects existing roster members only and implies no roster ownership.

## Matrix

Legend: **R** read, **C** create, **U** update, **D** delete, **P** publish, **own** own rows, **assigned** within assignment, **—** none. Enforced by server authorization **and** RLS wherever direct DB access exists.

| Entity / action | Public | User | Captain | Scorer | Editor | Dictator |
|---|---|---|---|---|---|---|
| Divisions, seasons, phases, config | R (published) | R | R | R | R | CRUD |
| Teams / team entries (structure) | R | R | R | R | R | CRUD |
| Team details & branding (allow-list above) | R | R | **U assigned team** | R | R | CRUD |
| Roles, assignments (`user_roles`) | — | R own | R own | R own | R own | CRUD |
| Person/player: create, delete, rename, account-link, roll number, email | R public fields | — | **—** | — | — | CRUD |
| Person/player: own profile fields (where authorized) | R | U own | U own | U own | U own | CRUD |
| Player FUT/presentation fields (allow-list) | R | — | **U assigned team's existing players** | — | — | CRUD |
| Roster membership (add/remove) | R | R | R own team; **no add/remove** | R | R | CRUD |
| Lineup | R after publish | — | C/U assigned team, existing members only, until lock | U/lock assigned matches | — | CRUD |
| Match schedule/teams/phase | R | R | R | R; U schedule fields if assigned | R | CRUD |
| Match state (status, minute/timer, score, penalties, final result) | R | R | — | **CRUD assigned, incl. corrections** | — | CRUD |
| Match events (goals, own goals, assists, scorer attribution, cards, undo) | R | R | — | **CRUD assigned, incl. later fixes** | — | CRUD |
| Standings/stats/leaderboards (derived) | R | R | R | R (recomputed from match edits) | R | R; recompute/regrade |
| Division predictions | — | CRUD own (before lock) | CRUD own | CRUD own | CRUD own | R all; regrade |
| World Cup fantasy | R | CRUD own | CRUD own | CRUD own | CRUD own | R all; data & grading |
| Newsletter content | R published | R | R | R | **C / U / P** (no delete) | CRUD |
| Polls, home content, share copy | R | vote | vote | vote | vote | CRUD |
| Registrations, forms, exports | — | C own | C/R own team | — | — | CRUD, export |
| Media upload | — | own avatar | assigned team logo/portraits | — | newsletter images only | all |
| Service credentials, system settings | — | — | — | — | — | server-side only |

## Hard boundaries (testable)

1. Scorer: no write on teams, players, rosters, accounts, roles, division/season config, editorial, or management.
2. Editor: write only newsletter content; no other table, no match, team, player, or role access. Editor cannot delete newsletter items.
3. Captain: no insert/delete on players or roster rows and no write to protected identity fields on any path; writes limited to the allow-list and the assigned team. **Captain access needs both:** the assignment to the team entry **and** the `captain` role. An assignment alone grants nothing, and the role alone grants nothing outside an assigned team. A dictator may act on any team. Implemented and tested for the player update function (`20261118000000_restrict_captain_update_team_member`); other captain paths must follow the same rule.
4. Scorer/captain writes outside assignment fail.
5. Configuration, assignments, and role changes require dictator.
6. A hidden UI control is never authorization.

## Legacy role mapping (no inferred permissions)

| Legacy `user_roles.role` | Maps to | Rule |
|---|---|---|
| `default` | user | direct |
| `captain` | captain | direct; assignment from `team_registrations` |
| `dictator` | dictator | direct |
| `editor` | **editor** | preserved; **newsletter-only**, no other rights |
| `admin` | **user (no elevated access)** unless a reviewed per-person assignment exists **before** the migration runs | The UI label "Scorer" and the broad access are *not* evidence of intent. Each legacy admin appears on a local-only review list; the owner reviews it and records scorer, dictator, or nothing per person *before* migration. Unreviewed admins become user. **Never automatic.** |

The legacy-admin review list is generated only against the **local** database (see SL-004 §3a). The local seed currently contains no `admin` users (roles: dictator, captain, editor, default).

## Current-state gaps this resolves (evidence)

- `user_roles_role_check` allows `default, editor, captain, dictator, admin`; `is_role_manager()` treats `admin` as a role manager.
- Baseline RLS has `USING (true)`/`WITH CHECK (true)` insert/update/delete for any `authenticated` user on `matches`, `goals`, `teams`, `players`, `newsletter`.
- Policy "Admin and Captain all access players" gives captains full player CRUD.
- The 7-argument `captain_update_team_member` is SECURITY DEFINER with no ownership check and writes `email`, a protected identity field.
- `admin`/`editor` string checks appear in 11 backend/frontend source files (e.g. `backend/app/api/admin/*`, `players/*`, `AdminDashboard.jsx`, `RoleWorkspace.jsx`, `ManageRoles.jsx`); `editor` currently gets newsletter routes alongside others and must be narrowed.

## Owner clarifications (2026-11-16)

- Captain allow-list includes FUT **overall rating** and **attributes** for existing players. Protected identity fields (roll number, email, name, account link) remain off-limits.
- Editor is newsletter create/edit/publish only; scorer is match data only; dictator manages everything.
