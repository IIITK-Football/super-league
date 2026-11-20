# D-04 decision: Workers reach Supabase through the Data API

Resolved by the owner on 2026-11-20. Applies to SL-030 and shapes SL-031 and SL-032.

## Decision
Option A of `D-04-workers-supabase-access-proposal.md`, with its rules and the proposal's defaults:
- The Data API over HTTPS (supabase-js), forwarding the caller's JWT. Row level security and the audit actor stay as they are today.
- Three clients per request: `publicClient()` (publishable key), `userClient(token)` (publishable key plus Bearer) and `jobClient()` (secret key, importable only by allowlisted modules).
- Token validation in middleware with `auth.getClaims(token)`; a missing, expired or tampered token gets a 401 before any query runs.
- Every multi-write operation is one RPC (SECURITY INVOKER by default). A write a person starts never uses the secret key.
- Timeouts, at most 3 sequential rounds per route (tested) and a `Server-Timing` header; Smart Placement is kept only if staging measurements improve.
- SL-030 must still prove the facts that came from documentation rather than measurement (the list in the proposal, section 3).

Direct Postgres through Hyperdrive stays out of scope; revisit only if a named job needs it.
