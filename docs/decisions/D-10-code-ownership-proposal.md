# D-10 proposal: code ownership and review requirements

Status: **proposal, open**. The owner resolves D-10 before SL-081 starts (Phase 8). Drafted 2026-11-18. This proposal changes no setting.

## 1. Current state
- **There is no `CODEOWNERS` file.** The requested ownership is Kevin for everything, Ebin for backend and Abhinav for frontend (SL-081).
- **The `main` ruleset** (`docs/process/ruleset-gate.json`):
  - 0 required approvals and no code-owner requirement;
  - the `gate` check, linear history, no force pushes or deletion;
  - **no bypass actors**.
- **The audit forbids a bypass on `main`.** `scripts/work/audit.mjs` fails any gate rule whose ruleset lists bypass actors. `develop` deliberately has no required rules.
- **Every PR into `main` is authored by Kevin.** Work happens on `develop` and only `main` takes PRs (`docs/process/workflow.md`); the agent uses Kevin's identity.
- **`CONTRIBUTING.md` disagrees:** it tells contributors to target `main` and keep merge commits, which conflicts with linear history and the `develop` workflow.
- **Handles:** Kevin is `kevinmatheuu` (`CONTRIBUTING.md`). Ebin's and Abhinav's handles are not recorded; git history suggests candidates, but they are unverified.

## 2. How GitHub resolves overlapping owners
- **Last match wins:** for each file, only the last matching `CODEOWNERS` line applies. `/backend/ @ebin` after `* @kevin` makes Ebin the only backend owner, so Kevin must appear on every line.
- **One owner is enough:** when a line lists several owners, an approval from any one of them satisfies it. GitHub cannot require both.
- **Authors cannot approve their own PRs.**
- **Owners need write access,** or the line is invalid.

**Consequence:** if code-owner review were required on `main`, Kevin's phase PRs would need approvals from Ebin and Abhinav, and from Kevin himself for root files. Kevin cannot approve his own PR, and the audit forbids a bypass, so every phase PR would be blocked.

## 3. Options
- **A:** require code-owner review on `main`. This blocks every phase PR, so it is rejected.
- **B:** `CODEOWNERS` for automatic review requests only; rulesets unchanged.
- **C:** B, plus a `develop` ruleset that requires code-owner review on PRs into `develop`, with Kevin as the only bypass actor, so his direct pushes keep working.

## 4. Recommendation: C
```
# Kevin owns everything. GitHub applies only the LAST matching line,
# so Kevin is repeated on every line; one listed owner's approval suffices.
*                         @kevinmatheuu
/backend/                 @kevinmatheuu @<ebin-handle>
/frontend/                @kevinmatheuu @<abhinav-handle>
# Gate-defining files stay Kevin-only (docs/process/workflow.md), even inside backend/.
/backend/tests/tooling/   @kevinmatheuu
/.github/                 @kevinmatheuu
```
- **`main`:** `ruleset-gate.json` is unchanged (0 approvals, no code-owner requirement, no bypass). Code owners are requested for review there as advice, not as a requirement.
- **`develop`:** a "Contributor review" ruleset with a pull-request requirement, 1 approval, code-owner review, and stale reviews dismissed on push. Kevin is the only bypass actor. The audit only checks `main`, so it keeps passing.
- **Effect:**
  - a contributor's backend change needs Kevin or Ebin;
  - a frontend change needs Kevin or Abhinav;
  - shared or policy files need Kevin.
- **Tests and docs:**
  - a repository test resolves owners by last match for representative paths and asserts that Kevin appears on every line;
  - `CONTRIBUTING.md` is updated so PRs target `develop` with linear history.
- **Who applies it:** the owner applies the settings and records the `develop` ruleset as JSON next to `ruleset-gate.json`.

## 5. Questions for the owner
1. Confirm Ebin's and Abhinav's GitHub handles and their write access. **Default: confirm the history candidates.**
2. Keep `main` at 0 approvals with no code-owner requirement? **Default: yes.**
3. Add the `develop` ruleset with Kevin as the only bypass actor? **Default: yes, 1 code-owner approval.**
4. Ebin and Abhinav open PRs into `develop` instead of pushing directly? **Default: yes.**
5. Keep the gate-defining files under `backend/tests/tooling/` Kevin-only? **Default: yes.**
6. Keep root shared files (`package.json`, `tests/`, `docs/`, `backlog/`, `supabase/`) Kevin-only? **Default: yes.**
7. Dismiss stale approvals on new pushes? **Default: yes.**
8. Fix `CONTRIBUTING.md` to target `develop` with linear history? **Default: yes.**
