# D-10 decision: code ownership

Resolved by the owner on 2026-11-20; implemented in Phase 8 (SL-081). Option C of `D-10-code-ownership-proposal.md`:
- `CODEOWNERS` with Kevin on every line, and the backend and frontend owners added to their own areas. Gate-defining files and `.github/` stay Kevin-only.
- `main` keeps `docs/process/ruleset-gate.json` unchanged (0 approvals, no code-owner requirement, no bypass).
- A `develop` ruleset requires one code-owner approval on pull requests, dismisses stale reviews, and lets only Kevin bypass, so direct pushes by the owner keep working.
- **Handles:** `@ebinthomas06` (backend) and `@AbhiKamp` (frontend), given by the owner. Their repository access was checked read-only on 2026-11-20 (`gh api …/collaborators/<handle>/permission`): `@ebinthomas06` admin, `@AbhiKamp` write, `@kevinmatheuu` admin, so all three are valid owners. Re-check in Phase 8 before CODEOWNERS is applied (a line with an owner who lacks write access is invalid).
- The proposal's remaining defaults are accepted (questions 2 to 8).

Nothing is applied before Phase 8; the owner applies the GitHub settings.
