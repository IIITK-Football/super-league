# D-06 proposal: R2 domains, Auth subdomain and bucket names

Status: **proposal, open**. The owner resolves D-06 before SL-073 starts (Phase 3); SL-075 (Phase 10) uses the Auth part. Drafted 2026-11-18 from the code. The purchased domain is written `<domain>`.

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

## 2. Options
- **Bucket names:**
  - **N1:** `sl-<env>-<purpose>` everywhere.
  - **N2:** keep the current production names and prefix only staging and local.
  - **N3:** one public bucket with prefixes, which contradicts the eight purposes.
- **Public hosts:**
  - **H1:** one `media.<domain>` served by the Worker. The Worker runs on every media request, including each HLS segment.
  - **H2:** one R2 custom domain per public bucket, on a first-level subdomain. Served directly with Cloudflare caching; each bucket's cutover and rollback is independent; covered by the free certificate.
  - **H3:** keep `r2.dev`, which is rate-limited and not meant for production.

## 3. Recommendation: N1 + H2
| Purpose | Access | Local (Wrangler) | Staging | Production | Production host |
|---|---|---|---|---|---|
| backup | **private** | `sl-local-backup` (fixtures) | none | `sl-prod-backup` | none (`r2.dev` off) |
| fresher-images | public, read-only archive | `sl-local-fresher-images` | `sl-staging-fresher-images` | `sl-prod-fresher-images` | `media-fresher-images.<domain>` |
| intro | public | `sl-local-intro` | `sl-staging-intro` | `sl-prod-intro` | `media-intro.<domain>` |
| news-images | public | `sl-local-news-images` | `sl-staging-news-images` | `sl-prod-news-images` | `media-news-images.<domain>` |
| player-images | public | `sl-local-player-images` | `sl-staging-player-images` | `sl-prod-player-images` | `media-player-images.<domain>` |
| playstyles | public | `sl-local-playstyles` | `sl-staging-playstyles` | `sl-prod-playstyles` | `media-playstyles.<domain>` |
| screenshot | public | `sl-local-screenshot` | `sl-staging-screenshot` | `sl-prod-screenshot` | `media-screenshot.<domain>` |
| team-logos | public | `sl-local-team-logos` | `sl-staging-team-logos` | `sl-prod-team-logos` | `media-team-logos.<domain>` |

- **Configuration names:** bindings `R2_<PURPOSE>` and public bases `MEDIA_BASE_<PURPOSE>` (SL-071). Nothing about backup ever appears in `VITE_*`.
- **Hosts by environment:** staging uses `r2.dev`; local uses the Worker; only production uses `<domain>`.
- **Stored references:** new rows store the purpose and key, not a host. SL-073 rewrites existing URLs once.
- **Auth:** `auth.<domain>`, production only, in Phase 10 (SL-075).
- **DNS plan:** reserve `auth` and `media-*`. Leave `<domain>` and `www` unassigned.
- **Credentials (SL-074):** one least-privilege token per bucket, with a separate one for backup.

**Cutover order.** Each production step is copy → verify → rewrite → switch → retire, with the owner's approval.
0. DNS zone; then local and staging, verified through the real app.
1. screenshot (can be regenerated, no rows).
2. playstyles (one constant).
3. intro (constant plus the proxy allow-list).
4. team-logos.
5. news-images.
6. player-images.
7. fresher-images (frozen as an archive).
8. backup, together with key rotation.
9. Phase 10: `auth.<domain>`.

## 4. Questions for the owner
1. Use `sl-<env>-<purpose>` names? **Default: yes.**
2. Keep current production buckets that already match a purpose instead of copying them? **Default: no,** because the separation is unverified; revisit after SL-070.
3. Per-bucket `media-<purpose>.<domain>` hosts? **Default: yes.**
4. Staging on `r2.dev`, with branded hosts only in production? **Default: yes.**
5. Freeze `fresher-images` and send new portraits to `player-images`? **Default: yes.**
6. Auth at `auth.<domain>`, production only, after SL-101? **Default: yes.**
7. Backup bucket in production only, plus a local fixture bucket? **Default: yes.**
8. Leave `<domain>` and `www` unassigned? **Default: yes.**
9. Approve the cutover order? **Default: yes.**
