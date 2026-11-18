# D-05 proposal: how many Workers, and which domains deploy separately

Status: **proposal, open**. The owner resolves D-05 before SL-030 starts. The evidence and the full comparison are in `docs/plans/SL-029.md` §D (local route inventory and latency measurements, 2026-11-18), and the access path is the D-04 proposal. This record states the recommendation and the questions.

## Evidence (summary)
- **54 route handlers** under `backend/app/api`:
  - 26 World Cup;
  - 9 division public reads;
  - 8 match, team and roster management;
  - 6 division predictions;
  - 3 newsletter;
  - 1 auth;
  - 1 media proxy.
- **Nothing shared differs between domains:** they use one database, one Auth system, one role model (SL-003), one owner and one deploy cadence. No route group has a different scaling profile or compliance boundary.
- **Latency comes from round trips, not compute:** route time ≈ sequential Supabase round trips × RTT. An extra Worker hop or a gateway hop adds latency rather than removing it. Running the Worker close to the database region (Smart Placement) matters more than the number of Workers.

## Recommendation
- **One modular Hono Worker,** served from the same origin as the Pages app (no browser CORS policy):
  - domain modules mounted under `/api/<domain>`: divisions, management, predictions, newsletter, auth, media, and World Cup as an isolated module with its own folder, tests and no imports from division modules;
  - shared middleware for token validation, scope resolution, errors and `Server-Timing`.
- **No separate gateway Worker** while there is one service.
- **Scheduled work** (World Cup sync and grading, prediction regrade) runs as Cron Triggers or Queue consumers of the same Worker project, not as request handlers.
- **Split triggers.** A domain gets its own Worker only when one of these is measured or decided:
  1. it needs a different deploy cadence or owner;
  2. a scheduled or CPU-heavy job exceeds the request Worker's limits after moving to a Cron Trigger or Queue;
  3. a secret (the secret key, private R2 credentials) needs a smaller blast radius than a module boundary gives;
  4. traffic isolation is measured as necessary.
- **World Cup is the first candidate** if a trigger fires.

## Questions for the owner
1. Adopt one modular Worker, same-origin with Pages, and no gateway? **Default: yes.**
2. Accept the four split triggers as the only reasons to add a Worker? **Default: yes.**
3. Run World Cup sync and grading as Cron Triggers of the same project? **Default: yes.** This also closes the unauthenticated manual sync routes noted in SL-025, as an isolated World Cup change.
4. Evaluate Smart Placement in SL-030 and keep it only if staging measurements improve? **Default: yes.**
