# D-04 proposal: how Workers access Supabase

Status: **proposal, open**. The owner resolves D-04, which unblocks SL-030 and shapes SL-031 and SL-032. The repository evidence was read on 2026-11-18. The Cloudflare and Supabase platform facts come from documentation, not measurement, so SL-030 must confirm them.

## 1. Current access patterns

- **The caller's token, with RLS deciding.** `backend/lib/roster/access.ts` builds one client per request from the publishable key and the caller's `Authorization` header, then `requireUser` calls `auth.getUser()`. About twenty route files use this `@supabase/ssr` client. Its Next `cookies()` part does not carry over to Workers.
- **Public reads with the publishable key.** `home/dashboard` and `players` do this. `backend/lib/scope.ts` resolves divisions and seasons under RLS, so hidden and archived seasons stay hidden.
- **The secret key, which bypasses RLS:** about 30 route files, all listed in `docs/supabase-key-usage.md` and enforced by `backend/tests/config/supabase-key-usage.test.ts`. They are World Cup cron sync and grading, admin prediction grading, two role-checked writes, and World Cup user routes; some of those trust a `user_id` sent by the client, and two sync routes have no authentication.
- **RPCs for atomic writes.**
  - `create_rostered_player`, `create_team_in_season`, `set_current_season` and `delete_unplayed_player` are SECURITY INVOKER, so RLS and `is_dictator()` apply.
  - `captain_update_roster_player` is SECURITY DEFINER and checks the caller itself.
  - `admin/team-registrations` makes up to four separate secret-key writes, and `admin/predictions/grade` writes predictions and then the match. Neither runs in a transaction.
- **The audit actor depends on the JWT reaching Postgres.** `audit_row_change()` records `auth.uid()` and the request role. PostgREST sets both for each transaction from the verified token, so secret-key writes are recorded as `service_role` with no person. A dictator's team registration already loses its actor today.

## 2. Options

**A. Data API (supabase-js over HTTPS), forwarding the caller's JWT, with the secret key only for allowlisted jobs**
- **Runtime:** `fetch` only. No TCP pool and no `nodejs_compat`. Each query counts against the subrequest limit.
- **Transactions:** each HTTP request is one transaction, so a multi-write operation is one RPC. That is already the repository's pattern.
- **RLS and audit:** unchanged. PostgREST verifies the token and sets the claims, so `auth.uid()` and the audit actor need no new code (`backend/tests/audit/audit-history.integration.test.ts` already proves this for direct Data API writes).
- **Latency:** each round costs one HTTPS round trip. SL-029 measured route time ≈ sequential rounds × RTT. That is mitigated by allowing at most 3 rounds and running the Worker near the database (Smart Placement).
- **Local development:** the same as today (127.0.0.1:54321).
- **Porting effort:** the lowest. Queries port as they are; only `NextResponse` and `cookies()` change.

**B. Direct Postgres through Hyperdrive and a driver**
- Keeping RLS needs a wrapper on every request: `BEGIN; SET LOCAL ROLE authenticated; set_config('request.jwt.claims', …, true); …; COMMIT`.
- **Risks:**
  - The Worker holds a database login that can bypass RLS. Any path that misses the wrapper runs privileged and records the wrong audit actor. That is a silent failure, worse than misusing the secret key.
  - The Worker becomes the only thing that verifies the JWT.
  - Transaction-mode pooling allows only `SET LOCAL`, and the query cache must be disabled.
  - We would rebuild what PostgREST already does.
  - Local development would need superuser credentials on port 54322 and a new test harness.
  - The browser keeps the Data API, so there would be two access paths.
- **Gains:** real multi-statement transactions and fewer bytes. But RPCs already give atomicity, and placement recovers most of the latency.

**C. Hybrid:** A by default, B for named heavy jobs. It has the costs of both, and no current route needs it. Keep it as a reason to revisit later.

## 3. Recommendation: A, with these rules

1. **One client per kind of call,** built per request, with session persistence and refresh turned off:
   - `publicClient()` (publishable key) for public reads;
   - `userClient(token)` (publishable key plus Bearer) for everything a signed-in caller does;
   - `jobClient()` (secret key), importable only by allowlisted modules.
2. **Token validation:**
   - Middleware accepts only `Authorization: Bearer` and verifies with `auth.getClaims(token)`. That is local verification against the cached JWKS when the project uses asymmetric signing keys; otherwise it calls the Auth server.
   - A missing, expired or tampered token gets a 401 before any query runs.
   - `auth.getUser()` is used only for privilege-changing actions.
   - Role checks run in SQL (`is_dictator()`), through the user client or inside RPCs, never as a secret-key read of `user_roles`.
3. **Atomicity:**
   - Every multi-table or multi-row write is one RPC, SECURITY INVOKER by default.
   - SECURITY DEFINER only with explicit `auth.uid()` checks and an empty `search_path`.
   - Team registration and prediction grading become RPCs in SL-032.
4. **Secret-key allowlist** (mirrors `docs/supabase-key-usage.md`; the key-usage test covers the Worker source):
   - World Cup sync, run as Cron Triggers or behind `CRON_SECRET`;
   - World Cup grading;
   - admin prediction grading, until a dictator-checked RPC replaces it;
   - nothing else. A write a person starts never uses the secret key, so the audit always names the person.
5. **Connections and timeouts:**
   - no module-scope client that carries a token;
   - `AbortSignal.timeout` of 8 s for requests and 20 s for jobs;
   - retry only idempotent GETs, once, on a network error;
   - at most 3 sequential rounds per route (with a test), plus a `Server-Timing` header;
   - Smart Placement, measured on staging.
6. **Secrets:**
   - `SUPABASE_URL` and the publishable key are vars;
   - `SUPABASE_SECRET_KEY` and `CRON_SECRET` are Worker secrets;
   - locally all four live in a git-ignored `.dev.vars`;
   - nothing in `VITE_*`.

**What SL-030 must prove locally** (`wrangler dev` or workerd against 127.0.0.1:54321 only; in dev the Worker refuses any non-local URL):
- the health endpoint responds;
- a public season read works;
- a real local user token is accepted;
- missing, expired or tampered tokens get a 401 with no database call;
- RLS refusals come through the Worker with nothing written: an anonymous write, a captain editing another team's player, a normal user switching the current season;
- a dictator's RPC write produces an `audit_log` row naming that dictator;
- an RPC that fails partway leaves nothing behind;
- the Worker bundle contains no secret;
- the dashboard route makes 3 rounds or fewer.

## 4. Questions for the owner

1. Adopt A and set B aside? **Default: yes.** Revisit only if a measured route misses its target despite 3 rounds or fewer and good placement.
2. Move staging, and later production, to asymmetric JWT signing keys so `getClaims` verifies without a network call? **Default: yes, staging first.** This is a Supabase setting, so it needs your approval. Locally, `signing_keys_path` is currently commented out.
3. During SL-032, move `admin/team-registrations` and `captain/team-branding` from the secret key to the user client plus an RPC, which restores the audit actor? **Default: yes.**
4. As a narrow, isolated and separately verified World Cup fix: take `user_id` from the verified token, and require `CRON_SECRET` or a dictator for the manual sync routes? **Default: yes.** Until then, those routes stay on Next.
5. Placement: Smart Placement, or a hint pointing at the database region? **Default: Smart Placement, measured on staging.**
6. Worker tests: `@cloudflare/vitest-pool-workers` plus one `wrangler dev` smoke test? **Default: yes.**
