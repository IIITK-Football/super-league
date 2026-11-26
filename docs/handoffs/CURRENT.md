# Current checkpoint

The live relay checkpoint shared by Claude (main checkout, `develop`) and
Codex (`../super-league-codex`, `codex/work`). The agent that stops rewrites
this file last, after committing its work. See `AGENTS.md` for the handoff
steps.

## Status

- **Updated:** 2026-11-26 by Claude.
- **Base commit:** `53f8e80` plus the relay setup commit.
- **Active item:** SL-030, Worker runtime, service boundaries and Supabase access (Phase 3). Not yet started with `pnpm work start`.
- **Acceptance:** `backlog/items/SL-030.md`, completion checks. Plan: `docs/plans/SL-030.md`; decisions D-04 and D-05.

## Done

- Relay setup: `AGENTS.md` and this file.

## Exact next step

1. `pnpm work start SL-030`.
2. Run the local Wrangler Worker against local Supabase (54322). Collect:
   - a scoped public read;
   - missing, expired and tampered tokens;
   - a denied write that leaves nothing stored;
   - a dictator write that records its actor;
   - a failed multi-write that rolls back.
3. Check that private credentials are absent from browser bundles and the Worker build output.

## In flight

Nothing uncommitted.

## Local database

Not checked this session. Run `pnpm work status` and check the migrations on 54322 before relying on them.

## Contributor prototypes to read when their item comes up

- #185 → SL-050 phone scorer.
- #186 → SL-053 lineups.
- #187 → SL-090 design system.

## Owner questions

None open. Hosted staging evidence for SL-030 needs the owner's approved access path or owner-run checks. See `docs/handoffs/2026-11-21-phase-3-next-session.md`.

## Order after SL-030

1. SL-031 → SL-032.
2. SL-040 → SL-044.
3. SL-045.
4. SL-050, SL-054.
5. SL-053, SL-108.
6. Phase 8: SL-104, SL-043, storage (SL-070 → SL-071 → SL-105 → SL-072 → SL-106), SL-060, SL-061.
7. Phase 9, then Phase 10.
