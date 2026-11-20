# D-05 decision: one modular Worker on the Pages origin, no gateway Worker

Resolved by the owner on 2026-11-20. Applies to SL-030, SL-031, SL-032 and SL-034.

## Decision
- **One modular Hono Worker**, served from the same origin as the Pages app, so the browser needs no CORS policy.
- **No separate gateway Worker.** SL-031 becomes same-origin routing from Pages (`/api/*`) to the Worker, tested, with stable auth, error and cache behavior.
- Domain modules mounted under `/api/<domain>`: divisions, management, predictions, newsletter, auth, media, and World Cup as an isolated module (its own folder and tests, no imports from division modules).
- Scheduled work (World Cup sync and grading, prediction regrade) runs as Cron Triggers or Queue consumers of the same project, not as request handlers.
- A domain gets its own Worker only when one of the proposal's four triggers is measured or decided: a different deploy cadence or owner; a job beyond the request Worker's limits; a secret needing a smaller blast radius than a module boundary; or measured traffic isolation. World Cup is the first candidate.
- World Cup stays frozen (`D-02-world-cup-separation.md`): its routes are ported behavior-identically with parity tests, with no new features.
