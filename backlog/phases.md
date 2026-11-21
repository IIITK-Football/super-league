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

### Phase 3 — Worker verification and storage cutover

The modular Worker and same-origin Pages route are implemented. The Phase 3 records distinguish deployed behavior, recorded verification, and formal item close-out.

1. Verify the Worker runtime and Supabase access against D-04 and D-05 (SL-030), then close out same-origin routing (SL-031).
2. Measure the current staging Worker dashboard and optimize where the baseline justifies it (SL-029). The latency work does not gate the runtime start.
3. Verify route-group parity against the compatibility baseline (SL-032). Public and protected routes can be checked while the full storage migration remains open. HLS parity requires the Worker video binding, local fixtures, and owner-authorized staging bucket preparation.
4. Inventory object ownership and references (SL-070), complete the storage interface and environment map (SL-071), configure play-style icon hosts (SL-105), then verify local emulation (SL-072). SL-104 expands player self-service independently of icon hosting.
5. Prepare and populate staging media, then cut over production one bucket at a time (SL-073) after parity, inventory, local emulation and staging verification. Production cutovers and credential rotation (SL-074) require owner approval. Retain objects needed by a prior compatible Worker and Pages release through the rollback window.
6. Retire the obsolete Next runtime and deployment (SL-034) after parity and an exercised Worker/Pages rollback.

Phases 4–6 consume the verified Worker and storage paths. See the [Phase 3 handoff](../docs/handoffs/2026-11-21-phase-3-next-session.md) for the evidence and the next implementation item.

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
