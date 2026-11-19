# Development workflow and its gates

The rules below are **enforced by scripts, hooks and CI**, not by instructions. Nobody, human or agent, decides case by case that a check can be skipped: there is no flag, variable or switch for it, and CI applies the same checks to every pull request.

## The principle

**Everyday work is fast. Validation is rigid, once, when a phase is completed.** You work directly on `develop`: a commit or push takes seconds, with no branch or pull request. The two real hurdles are `main` (protected, reached only by pull request) and the phase-completion gate.

| When | What runs | Enforced by |
|---|---|---|
| Every commit | Staged-file safety (env files, key files, secrets), Conventional Commit message (72 characters, no backlog references) | `pre-commit` and `commit-msg` hooks |
| Every push to `develop` | Git hygiene of the outgoing commits (no fixup/WIP/merge commits, no env or key files, no secrets); no direct push to `main`; no branch deletion. No branch or pull request needed | `pre-push` hook (same code as CI) |
| Starting an item | Order only: dependencies done, open decisions resolved, no earlier phase still open. No plan approval, groups or checks needed | `pnpm work start`; CI re-checks status changes |
| After a push to `develop` | A light CI pass for visibility: hygiene, backlog records, repository audit, and the cheap mapped-and-covered rule. **No test suite**, and not a merge requirement | CI |
| **Completing a phase** | Prerequisites of every item together (groups and acceptance checks defined, test files exist, the owner's attestations of manual checks); the strict test rules over everything the phase changed (every file mapped, covered by an active group, with a changed test); **every test group once**; evidence and a walkthrough per item, validated against the evidence | `pnpm work phase N --base <ref>` |
| Pull request into `main` | The full strict rules and the whole test suite, plus the same hygiene, records and audit | CI `gate` (required by the GitHub ruleset on `main`, with no bypass); nightly and manual runs use the whole suite too |
| Always | The safety boundaries (no hosted Supabase commands, no Docker removal, nothing touching the backup project, no reading `.env` files, no hook bypass, no GitHub settings changes, no merging into `main`) | The Claude Code guard (`.claude/settings.json`, `scripts/work/claude-guard.mjs`) |

For an item that builds a capability a person uses or configures, done includes its minimally usable flow in the existing frontend, verified through the real UI, API and database path (rule R10); database or API support alone is not done.

A finished item still needs, at phase completion: test groups that pass on a **clean tree** (evidence records the commit, tree and each command's exit code), each manual check **attested by the owner**, all ten cross-cutting rules marked `pass` or `n/a: <reason>`, and a complete walkthrough (`docs/walkthroughs/SL-xxx.md`: generated facts plus the author's Summary, Hosted actions, Assumptions and deviations, Risks and follow-ups, Rollback; no `TODO`, no stale evidence).

## Working on items

```
pnpm work status                     what is open
pnpm work start SL-020               begin (order is checked; nothing else)
# implement, commit and push directly on develop (no branch, no pull request)
pnpm work attest SL-020 C5 "note"    OWNER: attest a manual check (a hosted step); if the agent runs it, the owner confirms
pnpm work phase 2 --base <ref>       complete the phase: all the rigid validation, once
# fill in every TODO in the walkthroughs, commit, run `pnpm work phase 2 --base <ref>` again
pnpm work done SL-020 --base <ref>   (one item only; `phase` does this for all of them)
```

Item status is changed only by these commands. `pnpm work approve` and `pnpm work ready` still exist for an item that wants a plan signed off, but nothing requires them. Items closed before the workflow existed are `legacy-done`; items already underway are marked `legacy`.

## Publishing

Commit and push directly on `develop`. Only `main` needs a pull request: open one from `develop` when a phase is complete; the required `gate` runs the full rules and the whole suite, and the owner merges it and approves the `Database Production` job. A push to `develop` also runs the staging database deploy (migrations and the synthetic seed) through the approved workflow when migrations, the seed or the workflow files changed.

## What the Claude Code guard does

Before every Bash, Edit and Write call it decides deterministically: **deny** (the bypasses, the safety boundaries and the owner-only steps), **ask** (changing an existing GitHub ruleset; only the files that define the gates: `.claude/settings.json`, the hook wrappers, the guard itself, `tests/gate-exemptions.json` and `ci.yml`; and triggering or re-running a workflow, which is a hosted action), or allow. It judges what a command actually writes and runs, not words that appear in a commit message or a heredoc. Merging a pull request is allowed into `develop` and denied into `main`; a direct push to `main` is denied. Approvals, attestations and evidence cannot be written by hand. `tests` in `backend/tests/tooling/claude-guard.test.ts` pin each case, including what must stay allowed. At session start it reports the backlog and whether the hooks are installed.

## Owner setup (once)

1. **The GitHub rulesets (Settings, Rules, Rulesets).** `docs/process/ruleset-gate.json` ("Workflow gate") covers **`main` only**: a pull request, the `gate` check, linear history, no force pushes or deletion, and **no bypass actors**, so it binds administrators too. The older "Global Fork Enforcement" ruleset must not stop pushes to `develop`: it should keep `deletion` and `non_fast_forward` (no force pushes, no deletion) but drop its `update` and `creation` rules, which required a bypass for every push.
2. **Run the audit:** `pnpm work audit`. Every line must say PASS. It reads GitHub with read-only calls (needs `gh auth login` for a user who can read the repository settings).
3. **Optional hardening.** Project settings cannot stop a person on the same machine from editing `.claude/settings.json`. A root-owned managed settings file (macOS: `/Library/Application Support/ClaudeCode/managed-settings.json`) holding the same `permissions.deny` rules cannot be weakened by project or user settings.

## Limits (stated plainly)

- The agent uses the owner's GitHub identity, so the local guard and the owner-only commands stop the *agent*, not the owner or a session without this project's settings. Only the ruleset and CI bind everyone; that is why they are the authority. A separate, narrowly scoped credential for the agent would make merging and settings changes technically owner-only.
- The guard recognises commands by their shape. A shape nobody anticipated is a gap, which is what the CI `gate` is for.
- A person can run `git commit --no-verify` by hand. That skips only the local copy of the checks.

## Changing the workflow itself

Changes to the hooks, the guard, the group and exemption files, `ci.yml`, `.claude/settings.json` and `CLAUDE.md` need the owner's confirmation each time. Add an exemption only for a whole category of files that cannot be tested, with a reason. Prefer adding a test and declaring what a group `covers`.
