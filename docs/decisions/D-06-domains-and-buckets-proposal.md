# D-06 proposal: R2 domains, Auth subdomain and bucket names

Status: **proposal, open**. The owner resolves the remaining D-06 choices before SL-073 starts (Phase 3); SL-075 (Phase 10) uses the Auth part. Drafted 2026-11-18 from the code and updated 2026-11-19 with the purchased domain and owner directions. Domain: `superleague.dpdns.org`.

## 1. Current state
| Purpose (inferred) | Evidence |
|---|---|
| team-logos | `backend/app/api/captain/team-branding/route.ts`: `R2_LOGO_BUCKET` defaults to `team-logos`; the host falls back to an `r2.dev` URL |
| intro (HLS video, posters) | `backend/app/api/media/[...path]/route.ts`, `frontend/src/pages/LeagueLanding.jsx` |
| playstyles | `frontend/src/data/playStyles.js` |
| screenshot (share images) | read in `frontend/functions/_middleware.js`; written by `.github/workflows/og-screenshots.yml` |
| player portraits | `backend/lib/roster/playerImage.ts`: `R2_FRESHERS_BUCKET_NAME`, falling back to `R2_BUCKET_NAME` |
| news-images | `backend/app/api/admin/newsletter/upload-url/route.ts` (`R2_BUCKET_NAME`, `NEXT_PUBLIC_R2_URL`) |

- **One variable, two buckets.** `R2_BUCKET_NAME` is the newsletter bucket in the backend but the screenshot bucket in the CI workflow.
- **Freshers bucket for every division.** Portraits from all divisions go to the "freshers" bucket.
- **Backup is unreferenced.** Nothing in the repository mentions `backup`; SL-070 must find its writer.
- **Clients and settings.** There are four separate S3 clients and 11 R2 environment variables.
- **Stored URLs.** Database rows store full media URLs, so every host change needs a guarded rewrite (SL-073).
- **Constraints from the backlog:**
  - only media moves to `<domain>`; the website stays on Pages.dev;
  - every public bucket has its own public base;
  - only production uses the branded Auth domain, under one DNS plan;
  - backup stays private.
- **Owner directions (2026-11-19):** use `superleague.dpdns.org` for R2 media hostnames and keep the website on Pages.dev. Move all `fresher-images` objects into `player-images`, then deprecate `fresher-images` only after its objects, references, reads and writes have been reconciled and the rollback window has elapsed. Rewire backend media routes through the shared storage interface and replace random/client-named uploads with deterministic keys based on stable entity IDs and media purpose. A shared player portrait uses one identity-scoped key, `players/<player-id>.png`, independent of division, season, or team. Produce and dry-run the complete source-to-target rename plan before any bulk copying or uploading.

## 2. Options
- **Bucket names:**
  - **N1:** `sl-<env>-<purpose>` everywhere.
  - **N2:** keep existing production bucket names where their purpose still fits; use `sl-staging-<purpose>` and `sl-local-<purpose>` for non-production.
  - **N3:** one public bucket with prefixes, which contradicts the eight purposes.
- **Public hosts:**
  - **H1:** one `media.<domain>` served by the Worker. The Worker runs on every media request, including each HLS segment.
  - **H2:** one R2 custom domain per public bucket, on a first-level subdomain. Served directly with Cloudflare caching; each bucket's cutover and rollback is independent; covered by the free certificate.
  - **H3:** keep `r2.dev`, which is rate-limited and not meant for production.

## 3. Recommendation: N2 + H2 (owner decision on bucket names)
| Purpose | Access | Local (Wrangler) | Staging | Production | Production host |
|---|---|---|---|---|---|
| backup | **private** | `sl-local-backup` (fixtures) | none | `backup` | none (`r2.dev` off) |
| fresher-images | temporary public migration source; deprecate after verified move | `sl-local-fresher-images` | `sl-staging-fresher-images` | `fresher-images` (temporary) | temporary only; no final host |
| intro | public | `sl-local-intro` | `sl-staging-intro` | `intro` | `media-intro.superleague.dpdns.org` |
| news-images | public | `sl-local-news-images` | `sl-staging-news-images` | `news-images` | `media-news-images.superleague.dpdns.org` |
| player-images | public; canonical player portraits | `sl-local-player-images` | `sl-staging-player-images` | `player-images` | `media-player-images.superleague.dpdns.org` |
| playstyles | public | `sl-local-playstyles` | `sl-staging-playstyles` | `playstyles` | `media-playstyles.superleague.dpdns.org` |
| screenshot | public | `sl-local-screenshot` | `sl-staging-screenshot` | `screenshot` | `media-screenshot.superleague.dpdns.org` |
| team-logos | public | `sl-local-team-logos` | `sl-staging-team-logos` | `team-logos` | `media-team-logos.superleague.dpdns.org` |

- **Configuration names:** bindings `R2_<PURPOSE>` and public bases `MEDIA_BASE_<PURPOSE>` (SL-071). Nothing about backup ever appears in `VITE_*`.
- **Hosts by environment:** staging uses `r2.dev`; local uses the Worker; only production uses `superleague.dpdns.org` subdomains.
- **Stored references:** new rows store the purpose and key, not a host. SL-073 rewrites existing URLs once.
- **Auth:** `auth.superleague.dpdns.org`, production only, in Phase 10 (SL-075).
- **DNS plan:** reserve `auth` and `media-*`. Leave the apex `superleague.dpdns.org` and `www.superleague.dpdns.org` unassigned to Pages unless the owner later chooses to move the website off Pages.dev.
- **Credentials (SL-074):** one least-privilege token per bucket, with a separate one for backup.

**Cutover order.** Each production step is copy/rename → verify → rewrite → switch → retain for rollback → retire, with the owner's approval.
0. DNS zone; then local and staging, verified through the real app.
1. screenshot (can be regenerated, no rows).
2. playstyles (one constant).
3. intro (constant plus the proxy allow-list).
4. team-logos.
5. news-images.
6. player-images, including the verified move of all `fresher-images` objects and references.
7. Deprecate `fresher-images` after the rollback window and the no-reference check pass.
8. backup, together with key rotation.
9. Phase 10: `auth.<domain>`.

## 4. Questions for the owner
1. Use `sl-<env>-<purpose>` names everywhere? **Owner decision: no.** Keep existing production bucket names where their purpose still fits; use `sl-staging-<purpose>` and `sl-local-<purpose>` for non-production.
2. Keep current production buckets that already match a purpose instead of copying them? **Owner decision: yes**, except `fresher-images`, which is migrated into `player-images` and then deprecated after verification.
3. Per-bucket `media-<purpose>.<domain>` hosts? **Default: yes.**
4. Staging on `r2.dev`, with branded hosts only in production? **Default: yes.**
5. Move all current `fresher-images` objects into `player-images`, then deprecate the old bucket after verified cutover? **Owner direction: yes.**
6. Auth at `auth.<domain>`, production only, after SL-101? **Default: yes.**
7. Backup bucket in production only, plus a local fixture bucket? **Default: yes.**
8. Leave `<domain>` and `www` unassigned? **Default: yes.**
9. Approve the cutover order? **Default: yes.**
