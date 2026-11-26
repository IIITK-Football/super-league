# D-09 proposal: an outbound fixtures and results feed

Status: **historical proposal.** See [the resolved partner-feed decision](D-09-external-results.md). Reframed 2026-11-20 by the owner: Super League **provides** fixture and result data for other websites to consume. It does not import from Be.tech or any other fixture provider, and the earlier inbound-adapter proposal is withdrawn. Blocks SL-063 (Phase 6).

## 1. Current state
- No outbound feed exists. Public division data is served by the application's own routes (`/api/home/dashboard`, matches, standings), shaped for the current UI, and every route names a division by slug and a season by slug or id (`backend/lib/scope.ts`).
- Matches carry a schedule, a score cache and, after SL-022, canonical events. Hidden and archived seasons are already hidden by row level security.
- Writes stay entirely in the authorized scorer and dictator flows. The feed never writes.

## 2. Proposed design (SL-063 delivers it)
- **Contract:** versioned and read-only, under `/api/v1/feed/` (`divisions`, `seasons`, `fixtures`, `results`, `events`, `standings`). Only public, visible seasons. Stable ids (the match, team entry and season ids), ISO timestamps with a timezone, and a documented schema. Breaking changes mean a new version; the old one is announced as deprecated and kept for a stated window.
- **Caching:** strong `ETag` and `Last-Modified`, `Cache-Control` with `s-maxage` and `stale-while-revalidate` at the Cloudflare edge, shorter for live matches; conditional requests return 304.
- **Limits:** a per-consumer (or per-IP, if anonymous) rate limit with `429` and `Retry-After`, applied at the Worker.
- **Privacy:** no account data. Player names and photos appear only if the owner decides event detail is public (below).
- **Operations:** request logging by consumer, and a health check. Written once the SL-040 and SL-054 models (seasons, stages) are final.

## 3. Access options (the owner decides)
| | A. Public, anonymous | B. API keys issued by a dictator | C. Origin allowlist |
|---|---|---|---|
| Effort for consumers | none | request a key | none |
| Server-to-server use | yes | yes | no (an origin header is spoofable) |
| Attribution and revocation | no | yes | weak |
| Higher limits for partners | no | yes | no |
| Needs a minimal UI (R10) | no | yes (key management) | yes (list) |

**Recommendation:** A for the basic feed (the data is already public), plus optional keys (B) that raise the rate limit and identify partners. Not C.

## 4. Questions for the owner
1. Who may consume the feed: anonymous, keyed, or both? **Default: both, as recommended.**
2. Are player names and goal and card events public, or only fixtures, scores and standings? **Default: events with player names, as the site already shows them.**
3. Which divisions and seasons are included: every public season, or only the current one? **Default: every public season.**
4. How long is a deprecated version kept? **Default: 6 months.**
