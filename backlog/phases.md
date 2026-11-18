# Phases

Each backlog item file declares its phase. A phase is complete when every item in it is `done` or `legacy-done`; no item in a later phase can become ready before that (enforced by `pnpm work`).

### Phase 0 — Scope, semantics, and data safety

### Phase 1 — Local-first development and safety foundation

### Phase 2 — Canonical domain model, API contracts, and authorization

### Phase 3 — Hono and Cloudflare Workers backend migration

### Phase 4 — Shared division backend and product capabilities

### Phase 5 — Match operations, scorer workspace, lineups, and competition logic

### Phase 6 — Configurable home content, sharing, and external integrations

### Phase 7 — R2 redesign and Wrangler-local media

**Dependency:** Start only after Phase 3 establishes the Workers runtime, gateway, and storage interface. Do not create a separate Wrangler R2 implementation against the still-running Next/Vercel backend.

### Phase 8 — CI, repository policy, and contributor documentation

### Phase 9 — Frontend consolidation and full design-system redesign

**Start condition:** Phases 0–8 have stable data/API contracts, role capabilities, media paths, and release gates. This is intentionally the final major implementation phase: it consolidates, visually redesigns and refines flows that earlier phases already made usable (rule R10); it does not make a built feature usable for the first time. The user-reported tablet and visual defects should be reproduced here.

### Phase 10 — Controlled migration, release, and legacy retirement
