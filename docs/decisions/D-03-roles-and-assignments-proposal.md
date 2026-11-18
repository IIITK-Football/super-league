# D-03 proposal: multiple roles and scoped assignments

Status: **proposal, open**. The owner resolves D-03 and records the answers. Unblocks SL-024; SL-050 builds on it. The capability boundaries of `docs/decisions/SL-003-role-capability-matrix.md` are unchanged: no role implies another, only a dictator changes roles and assignments, and captain access needs both the role and an assignment (SL-003 rule 3).

## 1. Current state

- **One role per user.** `user_roles(user_id, role)` has `PRIMARY KEY (user_id)` (`baseline.sql:529-533, 737-738`), check `default/editor/captain/dictator` (`admin` removed by `20261130000000`). New accounts get `default` (`handle_new_user_role`, `baseline.sql:181-191`). `get_user_role()` is dropped (`20261130000000`).
- **Legacy `admin` grants nothing (2026-11-19).** It was a broad role labelled "Scorer" that managed roles and wrote matches, newsletter and predictions. `20261129000000_legacy_admin_grants_nothing.sql` made `is_role_manager()` and those policies dictator-only, and API routes and UI no longer accept `admin`. `20261130000000_retire_legacy_admin_role.sql` sets remaining `admin` rows to `default` (audited), removes `admin` from the role check and drops the unused `get_user_role()`. `is_role_manager()` stays, dictator-only, until this proposal's helpers replace it.
- **`editor`** stays newsletter-only (`RoleWorkspace.jsx:17`).
- **Captain = role + `team_registrations.captain_id`.** `UNIQUE (captain_id)` (`baseline.sql:702-703`) means one team per captain **across all seasons**. FK to `auth.users` is `ON DELETE CASCADE` (`:898`). The team is linked by `team_id` (`ON DELETE SET NULL`, `:903`) and `season_id` (`divisions_and_seasons.sql:117`, `NOT NULL` from `retire_legacy_division_paths.sql:86`). Readers: `captain_update_roster_player` (`player_identity_rosters.sql:530-541`), `captain/team-branding/route.ts:72-75` (no season filter, relies on the global unique key), `admin/freshers/player-image/route.ts:29-38`, `admin/team-registrations/route.ts:41-82` (the upsert behind the captain-change defect, and it also upserts the `captain` role, `:82`).
- **`is_dictator()`** checks `role = 'dictator'` only (`divisions_and_seasons.sql:171-178`); the newer division tables use it.
- **No scorer is stored.** `admin/matches/live/route.ts:46-51` lets `dictator` **and `captain`** write live match state (`admin` removed 2026-11-19): a captain can score any match today, which SL-003 forbids.
- **Local data** (read-only query, port 54322): `default 46, captain 2, dictator 1, editor 1, admin 0` (before 2026-11-19); 2 registrations, both map to a `team_entries` row and both captains hold the `captain` role.

## 2. Multiple roles

| Option | Shape | Assessment |
|---|---|---|
| A. One role (today) | `user_roles` PK `user_id` | Cannot express an editor who also scores, or a dictator who captains a team. Forces the old pattern where one label carries several powers. |
| B. **Set of role grants** | one row per `(user_id, role)` | Each grant is independent; checks are "holds role X", never a rank. Matches "no role implies another". |
| C. Roles derived from assignments | no role table | Breaks SL-003 rule 3 (role **and** assignment); editor and dictator have no assignment to derive from. |

**Recommendation: B.** Reshape `user_roles` in place: `PRIMARY KEY (user_id, role)`, `role IN ('captain','scorer','editor','dictator')`, plus `granted_by uuid`, `granted_at timestamptz`. **Normal user is the absence of grants** (no `default` row; `handle_new_user_role` is dropped). Only dictators write it. A guard refuses removing the last dictator grant. SL-024 ports every reader in the same slice, so no compatibility view is kept (one source of truth).

## 3. Scoped assignments

### Tables

```sql
-- team_entries gains UNIQUE (id, season_id) so the season can be enforced with a composite FK.
CREATE TABLE public.captain_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_entry_id uuid NOT NULL,
  season_id     uuid NOT NULL,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (team_entry_id, season_id) REFERENCES public.team_entries(id, season_id) ON DELETE CASCADE,
  UNIQUE (team_entry_id),          -- one captain per team entry (see Q3)
  UNIQUE (user_id, season_id)      -- one team per captain per season (409 on conflict)
);

CREATE TABLE public.scorer_assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  season_id   uuid REFERENCES public.seasons(id) ON DELETE RESTRICT,
  match_id    uuid REFERENCES public.matches(id) ON DELETE CASCADE,
  expires_at  timestamptz,         -- optional; SL-050 invitations set it
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(season_id, match_id) = 1)
);
CREATE UNIQUE INDEX ON public.scorer_assignments (user_id, season_id) WHERE season_id IS NOT NULL;
CREATE UNIQUE INDEX ON public.scorer_assignments (user_id, match_id) WHERE match_id IS NOT NULL;
```

ON DELETE: deleting a user removes their grants and assignments (as today). Deleting a team entry or match removes the now meaningless assignment; seasons stay `RESTRICT`, consistent with `team_entries`. Revocation is a hard delete; the SL-027 audit trigger on all three tables keeps the history, so no `revoked_at` columns or partial uniques are needed.

**Captain change** (the SL-024 defect): `UPDATE captain_assignments SET user_id = …` on the existing row. Roster and season stay with the team entry; `UNIQUE (user_id, season_id)` gives the clear 409 for a captain already assigned elsewhere this season. The previous captain keeps the inert `captain` grant unless the dictator revokes it (see Q4).

**SL-050 invitations** (built there, shape reserved here): `scorer_invitations(id, token_hash, season_id | match_id, intended_user_id NOT NULL, expires_at, revoked_at, accepted_at)`. Acceptance is a `SECURITY DEFINER` RPC that requires `auth.uid() = intended_user_id`, an unexpired, unrevoked, unaccepted invitation, and inserts only a `scorer_assignments` row (plus the `scorer` grant if Q5 allows). It can never write `dictator` or any other role.

### Helpers (all `STABLE SECURITY DEFINER`, `search_path ''`, `row_security off`)

- `has_role(p_role text) → boolean`: grant exists for `auth.uid()`.
- `is_dictator()`: redefined as `has_role('dictator')` (existing callers keep working).
- `is_captain_of(p_team_entry uuid)`: `has_role('captain') AND` an assignment for that entry.
- `can_score(p_match uuid)`: `has_role('scorer') AND` an unexpired assignment on that match or its `season_id`.
- `my_roles() → text[]` for the UI; `is_role_manager()` is dropped (`get_user_role()` already is).

Helpers never include the dictator; policies spell it out (`is_dictator() OR can_score(id)`), so every capability stays visible at the call site.

### RLS sketch

- `user_roles`, `captain_assignments`, `scorer_assignments`: `SELECT` own rows or `is_dictator()`; `INSERT/UPDATE/DELETE` only `is_dictator()`. Public captain names, if shown, come through a view or API exposing name only.
- `matches`, match events: write `is_dictator() OR can_score(id)`; replaces the `admin/dictator` policies (`baseline.sql:963`).
- Team branding and `captain_update_roster_player`: `is_dictator() OR is_captain_of(entry)`.
- Newsletter: `has_role('editor') OR is_dictator()` for create/edit/publish; delete dictator only.
- API checks call the same helpers through RPC (no reimplementation in route code); the live route drops `captain`.

## 4. Data migration (one transactional forward migration, guarded)

1. Abort if any `team_registrations` row has a null `team_id` or no matching `team_entries (team_id, season_id)`, or if any captain holds two registrations in one season.
2. Grants: `default` → no row; `captain`, `editor`, `dictator` → same grant. No `admin` row remains (`20261130000000` already set them to `default`, audited; SL-004 §3a); the migration asserts none exists.
3. `team_registrations` → `captain_assignments` (one row each, `assigned_at = created_at`). Postcondition: row counts equal and every pair `(captain_id, team_id, season_id)` matches; registration captains lacking the role are reported (0 locally).
4. Same slice: port every reader listed in §1 and the seed and staging checks; then a later migration in SL-024 drops `team_registrations` after a guard confirms no runtime reader and equal counts. `team_registrations.team_name` is compared with `teams.name` first, and any difference is reported, not silently lost.
5. No legacy `admin` is re-granted: there is no reviewed list (owner decision 2026-11-19). A dictator grants roles to former admins only as to any other user.

## 5. Questions for the owner

1. **Multiple roles via a set of grants (option B)?** Default: yes.
2. **Scorer scope: season or single match only, or also a whole division across seasons?** Default: season or match; a new season needs a new assignment.
3. **One captain per team entry, or allow co-captains?** Default: one (`UNIQUE (team_entry_id)`); a vice-captain can be added later as a separate decision.
4. **On captain change, does the previous captain keep the `captain` grant?** Default: keep it (it grants nothing without an assignment); the dashboard shows grants with no assignment so the dictator can revoke them.
5. **Does assigning a captain or scorer also add the matching role grant automatically?** Default: yes, in the same transaction and audited, because it is an explicit dictator action (today's route already does this). Removing an assignment never removes a grant automatically.
6. **Legacy `admin` holders:** *answered by the owner 2026-11-19:* never ported or promoted; their `admin` rows are removed and the accounts stay ordinary users (Auth accounts and profiles kept), with no review or re-grant path. `/dictator` is the canonical dashboard URL and `/admin` redirects to it. Done by `20261129000000` and `20261130000000`.
7. **May a captain-assigned user also score matches involving their own team?** Default: technically allowed if the dictator assigns it (no role implies another, and no role forbids another); the dashboard warns.
8. **Do scorer assignments expire?** Default: optional `expires_at`, null for dictator-made assignments, required for SL-050 invitations.
