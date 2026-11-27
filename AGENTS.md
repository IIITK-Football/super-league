# Super League: Codex worktree

Claude and Codex share one work stream and take turns. Only one agent is
active at a time. Claude works in the main checkout on `develop`; Codex works
in this worktree on `codex/work`. The branches are kept identical at every
handoff, so each sync is a fast-forward.

## Start of a session

1. Read `docs/handoffs/CURRENT.md` (the live checkpoint), `CLAUDE.md` and
   `docs/process/workflow.md`. CLAUDE.md is the project brief for both agents.
2. Sync: `git merge --ff-only develop`. If it refuses, stop and report; never
   create a merge commit.
3. Run `pnpm install` in any package whose lockfile changed, and apply or
   reset the local database as CURRENT.md says.
4. Continue from the exact next step in CURRENT.md, in backlog order
   (`backlog/phases.md`, `pnpm work status`).

## While working

- Commit each completed, checked step (Conventional Commits, no backlog or
  `SL` references in messages, no AI attribution of any kind). Never leave
  uncommitted work at a stop.
- After every commit, update CURRENT.md: active item and its checks, what is
  done (with hashes), the exact next step, files in flight, failing tests,
  local database state and owner questions. A usage limit can stop you at any
  time.
- Contributor branches and pull requests are design references and
  prototypes. Read them before the matching item, reuse what is useful, and
  note what was reused in CURRENT.md. Do not merge them as they are.

## Publishing to staging and handing back to Claude

Commit each locally verified stage and update CURRENT.md. In the main checkout,
fast-forward `develop` from `codex/work` and push `develop` through the existing
staging workflow. Use the provided Cloudflare Access service token for the
staging walkthrough. Record the deployed commit and results in CURRENT.md.

## Safety boundaries (Claude's guard does not cover Codex)

- Use local Supabase on port 54322 for development. On hosted staging, use
  the approved `develop` deployment workflow and the repo's staging verification
  scripts. Never use linked or remote Supabase CLI commands, access production,
  or touch the `superLeagueBackup` project (port 55322).
- Never stop, prune or delete Docker containers, networks or volumes.
- Never print or commit secrets from `.env*`, Supabase state, CI or
  Cloudflare.
- Publish staging through `develop`. The owner manages `main`, production,
  service settings, credentials, and deployments outside the staging workflow.
- No force push, no branch deletion, no fixup, WIP or merge commits.
- Never ask for Computer Use permission or invoke Computer Use when it would
  prompt for approval. Use available connectors, APIs or CLI tools instead.
  If those cannot complete a step, report the blocker.
