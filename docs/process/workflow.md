# Development workflow and its gates

The rules below are **enforced by scripts, hooks and CI**, not by instructions. Nobody, human or agent, decides case by case that a check can be skipped: there is no flag, variable or switch for it, and CI applies the same checks to every pull request.

## What is enforced, and where

| Gate | What it requires | Enforced by |
|---|---|---|
| **Definition of Ready** | An item can start only when: its dependencies are done; the open decisions it names are resolved; it names test groups that really have tests; every acceptance check says how it is verified; a plan exists in `docs/plans/SL-xxx.md` with every section filled in; the **owner approved that exact plan**; and no earlier phase has unfinished items. | `pnpm work ready` / `start`; CI re-checks every status change (`pnpm work check --base`) |
| **Tests required** | Every changed file is *mapped* to a test group, *covered* by an active group (pending groups cover nothing), and the change contains a *changed test* from a group that covers it. Only categories listed with a reason in `tests/gate-exemptions.json` need none. | `node scripts/test-groups.mjs check`, run by the pre-commit hook (all but the changed-test rule), the pre-push hook and CI (the whole range) |
| **Git hygiene** | Conventional Commit messages (72 characters), no backlog or SL references in messages, no fixup/squash/WIP commits, no merge commits, no env or key files, no secrets in added lines, no force pushes, nothing pushed to `develop` or `main` directly. | `commit-msg`, `pre-commit` and `pre-push` hooks; CI `hygiene`; the GitHub ruleset |
| **Definition of Done** | The item's test groups pass on a **clean tree** (evidence records the commit, tree and each command's exit code); automated checks pass; each manual check is **attested by the owner**; all ten cross-cutting rules are marked `pass` or `n/a: <reason>`; the walkthrough is complete and matches the evidence. | `pnpm work done`; CI validates every `done` item the same way |
| **Plans** | One tracked plan per item with the sections Issue, Evidence, Scope, Acceptance checks, Tests, Rollback. A plan changed after approval needs approving again (the approval stores its hash). | Definition of Ready |
| **Completion walkthrough** | `docs/walkthroughs/SL-xxx.md`: generated facts (commits, files by group, evidence, check results) plus the author's Summary, Hosted actions, Assumptions and deviations, Risks and follow-ups, Rollback. | `pnpm work done` writes it; the validator rejects any `TODO`, a missing section, an unaccounted rule or check, or stale evidence |
| **Safety boundaries** | No hosted Supabase commands, no Docker removal, nothing touching the `superLeagueBackup` project, no reading `.env` files, no GitHub settings changes, no hook bypass, no merging, no owner-only steps. | The Claude Code guard (`.claude/settings.json`, `scripts/work/claude-guard.mjs`) |
| **One required check** | `gate` succeeds only if `hygiene`, `records`, `tests` and `audit` all *succeeded* (a skipped job fails it). | `.github/workflows/ci.yml` and the GitHub ruleset |

## Working on an item

```
pnpm work status                     what is open
pnpm work status SL-020              what an item still needs
# write docs/plans/SL-020.md, define groups and checks in the item, resolve its decisions
pnpm work approve SL-020             OWNER: approve the plan (typed with ! in the session)
pnpm work ready SL-020               Definition of Ready, then start it
pnpm work start SL-020
# implement test first; commit atomically (the hooks run)
pnpm work attest SL-020 C5 "note"    OWNER: attest a manual check (a hosted step)
pnpm work done SL-020                runs groups and checks, writes the walkthrough skeleton
# fill in every TODO in docs/walkthroughs/SL-020.md, commit, run `pnpm work done SL-020` again
```

Item status is changed only by these commands. Items closed before the workflow existed are `legacy-done`; items that were already underway are marked `legacy` and are not asked for a plan approval, but still need checks and, to finish, a walkthrough.

## Publishing

`develop` and `main` are reached by pull request. Work stays on local `develop`; to publish, push a branch named `ready/<short-name>` and open a pull request into `develop`. The pre-push hook only allows `ready/*` branches and runs the hygiene and test rules over the outgoing range first. The merge happens when the required `gate` check passes; merging and everything hosted stay the owner's decision.

## What the Claude Code guard does

Before every Bash, Edit and Write call it decides deterministically: **deny** (the bypasses and owner-only steps above), **ask** (editing the enforcement itself: hooks, settings, the guard, the groups and exemptions files, `ci.yml`, `CLAUDE.md`, or triggering a workflow, which the owner then confirms), or allow. Approvals, attestations and evidence cannot be written by hand. `tests` in `backend/tests/tooling/claude-guard.test.ts` pin each case, including what must stay allowed. At session start it reports the backlog and whether the hooks are installed.

## Owner setup (once)

1. **Import the ruleset.** GitHub → Settings → Rules → Rulesets → New ruleset → *Import a ruleset* → choose `docs/process/ruleset-gate.json`. It covers `develop` and `main`, requires a pull request and the `gate` check, forbids force pushes and deletion, requires linear history, and has **no bypass actors**, so it binds administrators too. The first pull request must pass `gate` before the check can be selected; if the import cannot find it yet, open one pull request first. The organisation's existing "Global Fork Enforcement" ruleset is unaffected.
2. **Run the audit:** `pnpm work audit`. Every line must say PASS. It reads GitHub with read-only calls (needs `gh auth login` for a user who can read the repository settings).
3. **Optional hardening.** Project settings cannot stop a person on the same machine from editing `.claude/settings.json`. A root-owned managed settings file (macOS: `/Library/Application Support/ClaudeCode/managed-settings.json`) holding the same `permissions.deny` rules cannot be weakened by project or user settings.

## Limits (stated plainly)

- The agent uses the owner's GitHub identity, so the local guard and the owner-only commands stop the *agent*, not the owner or a session without this project's settings. Only the ruleset and CI bind everyone; that is why they are the authority. A separate, narrowly scoped credential for the agent would make merging and settings changes technically owner-only.
- The guard recognises commands by their shape. A shape nobody anticipated is a gap, which is what the CI `gate` is for.
- A person can run `git commit --no-verify` by hand. That skips only the local copy of the checks.

## Changing the workflow itself

Changes to the hooks, the guard, the group and exemption files, `ci.yml`, `.claude/settings.json` and `CLAUDE.md` need the owner's confirmation each time. Add an exemption only for a whole category of files that cannot be tested, with a reason. Prefer adding a test and declaring what a group `covers`.
