# D-03: Roles and scoped assignments

**Status:** Resolved by the owner on 2026-11-19. Applies to SL-024 (five roles with scoped captain and scorer assignments) and to SL-050, which builds on the scorer assignments. The capability boundaries of `SL-003-role-capability-matrix.md` are unchanged. Design detail is in `D-03-roles-and-assignments-proposal.md`, reconciled with this record. Where the two differ, this record wins.

## Decision

1. **Independent role grants.**
   - One person may hold several explicitly granted roles (captain, scorer, editor, dictator).
   - No role implies another.
   - A normal user is someone with no elevated-role grant; there is no `default` grant.
   - Only dictators grant or revoke roles and assignments.
2. **Captain assignments are scoped to an exact team entry and its season.**
   - **One captain per team entry, no co-captains:** `UNIQUE (team_entry_id)`.
   - **One person may captain several team entries,** across seasons and divisions. There is **no** `UNIQUE (user_id)` and **no** `UNIQUE (user_id, season_id)`.
   - **Assigning someone as captain** adds the `captain` grant automatically, in the same transaction and audited. That includes someone who already holds other grants: an editor keeps the editor grant and gains captain, so both roles are explicitly granted by the dictator's action.
   - **Changing a team entry's captain** updates its one assignment row; the previous captain is then handled as in point 3.
3. **Revoking captain assignments.**
   - An assignment is **active** while its season is the current season. Past-season assignments are history: they grant no write access and do not keep the captain grant.
   - Revoking one assignment never removes the captain capability while the person still has another **active** captain assignment.
   - When the last active captain assignment is revoked, **only** the `captain` grant is removed. Every other grant (dictator, editor, scorer) is kept, and the audit history keeps every change.
   - A historical assignment never gives current write access: captain writes require an active assignment for the exact team entry.
4. **Dictators keep dictator permissions** when they are also assigned as a captain; dictator precedence applies everywhere (Team Builder, RPCs, policies).
5. **Scorers.**
   - **Grant and assignment:** scorer access requires the `scorer` grant **and** an explicit scorer assignment scoped to a season or a single match. Assigning a scorer adds the `scorer` grant automatically, like captains.
   - **No implication:** captain status never implies scorer access.
   - **Scoring your own team's match:** a captain may score a match involving their own team only with an explicit scorer assignment, and the dashboard shows a warning when that assignment is made.
   - **Expiry:** scorer assignments have an optional `expires_at`: empty for dictator-made assignments, required for SL-050 invitations.
6. **Legacy `admin`:** no legacy admin account or privilege is ported or promoted. This is already done by `20261129000000` and `20261130000000`.

## Answers to the proposal's questions
| Proposal question | Answer |
|---|---|
| Q1 multiple roles via a set of grants (option B) | Yes |
| Q2 scorer scope | A season or a single match |
| Q3 one captain per team entry | Yes; no co-captains |
| Q4 previous captain keeps the grant | **No (differs from the proposal default):** the captain grant is removed when the last active captain assignment is revoked; other grants are kept |
| Q5 assigning adds the role grant | Yes, for captains and scorers. **Removing the last active assignment removes that grant (differs from the proposal's "never removes a grant").** |
| Q6 legacy `admin` | Never ported (answered and done earlier) |
| Q7 captain scoring their own team | Only with an explicit scorer assignment, with a dashboard warning |
| Q8 scorer assignment expiry | Optional `expires_at`; required for SL-050 invitations |

## Addendum (2026-11-20): when a captain assignment is writable, and branding scope
Resolves how captains prepare a future season without touching past ones. Applies to SL-024, and later to SL-045 and SL-053.

1. **Writable assignment.** A captain assignment grants writes while its season has `archived_at IS NULL`, its status is not `completed`, and the season is either current (`is_current`) or upcoming (status `planned` or `registration`). Entries of completed or archived seasons are read-only history. This replaces "active while its season is the current season" in point 3 of the decision.
2. **Scope.** Roster-detail and lineup writes need a writable assignment for the exact `team_entry_id`; the allow-list in SL-003 is unchanged. A dictator keeps precedence everywhere (point 4).
3. **Branding is team-level (owner decision).** A team's name, short name, logo and colours live on the shared `teams` row. Any captain with a writable assignment for one of that team's entries may edit them. Past seasons show the current branding, and the SL-027 history keeps the old values. No branding is copied onto `team_entries`.
4. **Grant lapse.** The `captain` grant is removed when the person's last writable assignment is revoked, or when its season is completed or archived. This happens inside dictator-only lifecycle RPCs (`set_current_season` and the complete/archive RPC), audited, never through a trigger. Clients cannot write `seasons.status`, `is_current` or `archived_at` directly. Every other grant is kept.
5. **Migration.** Assignments created from `team_registrations` whose season is no longer writable are kept as history, and their holders lose the `captain` grant if they have no writable assignment. The migration reports that list for the owner before the release (the clone rehearsal).
