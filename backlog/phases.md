# Phases

Each backlog item file declares its phase. A phase is complete when every item in it is `done` or `legacy-done`; no item in a later phase can become ready before that (enforced by `pnpm work`). Inside a phase, `dependsOn` gives the order.

**Restructured 2026-11-18 (owner instruction):** unfinished work is organised as end-to-end feature slices. Each slice delivers, in its own phase:
- the schema and data migration with data-preservation guards;
- the API;
- a minimal usable frontend for the people who need it;
- local and staging verification.

A slice ports every known caller and then retires the path it replaces, so legacy and canonical paths do not run side by side indefinitely. Items folded into others are listed in `superseded.json`.

### Phase 0 — Scope, semantics, and data safety

### Phase 1 — Local-first development and safety foundation

### Phase 2 — Canonical domain slices, end to end

Order:
1. Divisions and seasons (SL-020, done).
2. Player identity, season teams and rosters (SL-021).
3. Audit history (SL-027).
4. Account-linked players and self-service profile (SL-042).
5. Five roles with scoped assignments (SL-024).
6. Canonical match events and statistics (SL-022).
7. Security audit of the final schema (SL-025).
8. API contracts (SL-026).

These slices run on the current Next API, so that Phase 3 ports each final model once.

### Phase 3 — Workers backend migration and the complete storage system

1. Measure and reduce warm latency on the existing Vercel Preview backend and assess the minimum sufficient Worker topology (SL-029).
2. Establish the Worker runtime and Supabase access (SL-030), then same-origin routing to it (SL-031).
3. All R2 work after the Worker runtime: inventory (SL-070), storage abstraction (SL-071), Wrangler local emulation (SL-072).
4. The parity port (SL-032).
5. Bucket reorganization, custom domain and configuration (SL-073), rolled out local → staging → production one bucket at a time, each production cutover owner-approved and verified before its old path is retired.
6. Credential rotation (SL-074).
7. Retirement of the Next backend (SL-034).

**Dependency:** do not create a Wrangler R2 implementation against the still-running Next/Vercel backend. Phases 4–6 consume the finished storage system and never redo its migration.

### Phase 4 — Division and season product capabilities

- Configuration, visibility, order, sections and navigation (SL-040).
- Fantasy, with World Cup decoupled (SL-043).
- Rules builder (SL-044).
- Registration (SL-045).
- Exports and integrity (SL-046).
- Sign-in allowlists (SL-047).

### Phase 5 — Match operations

- Phone/offline scorer workspace (SL-050).
- Lineups (SL-053).
- Formats, stages and brackets (SL-054).

### Phase 6 — Configurable home content, sharing, and external integrations

- Home configuration (SL-060).
- Sharing and Open Graph metadata (SL-061).
- Schedule and score adapters (SL-063).

### Phase 7 — (merged into Phase 3)

The R2 storage items moved to Phase 3 on 2026-11-18. The phase number is kept so other phase numbers stay stable; it holds no items.

### Phase 8 — CI, repository policy, and contributor documentation

### Phase 9 — Frontend consolidation and full design-system redesign

**Start condition:** Phases 0–8 have stable data/API contracts, role capabilities, media paths, and release gates. This is intentionally the final major implementation phase: it consolidates, visually redesigns and refines flows that earlier phases already made usable (rule R10); it does not make a built feature usable for the first time. The user-reported tablet and visual defects should be reproduced here.

### Phase 10 — Production cutover, branded Auth domain, and final legacy sweep
