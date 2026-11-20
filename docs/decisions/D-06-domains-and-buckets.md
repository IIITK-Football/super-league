# D-06 decision: R2 domains, Auth subdomain and bucket names

Resolved by the owner on 2026-11-20. Applies to SL-073, SL-074 and SL-075. The table, cutover order and DNS plan are in `D-06-domains-and-buckets-proposal.md` section 3 and are adopted as written.

## Decision
- **Names (N2):** keep the existing production bucket names where their purpose still fits; `sl-staging-<purpose>` and `sl-local-<purpose>` elsewhere. `fresher-images` is a temporary migration source: its objects move into `player-images`, and it is deprecated only after the objects, references, reads and writes are reconciled and the rollback window has passed.
- **Hosts (H2):** one R2 custom domain per public bucket on `superleague.dpdns.org` (`media-<purpose>.superleague.dpdns.org`), production only; staging uses `r2.dev`; local uses the Worker. The website stays on Pages.dev, and the apex and `www` stay unassigned.
- **Auth:** `auth.superleague.dpdns.org`, production only, in Phase 10 (SL-075). It probably needs a paid Supabase add-on, which needs the owner's approval of the cost first.
- **Configuration:** bindings `R2_<PURPOSE>` and public bases `MEDIA_BASE_<PURPOSE>`; new rows store the purpose and key, not a host.
- **Backup:** private, production only, plus a local fixture bucket; never referenced from `VITE_*`.
- **Order:** screenshot, playstyles, intro, team-logos, news-images, player-images (with the `fresher-images` move), the `fresher-images` deprecation, backup with key rotation, then Auth. Every production step is copy, verify, rewrite, switch, retain, retire, with the owner's approval and one bucket at a time.
- **Screenshot upload (from SL-100):** the screenshot job uploads only from `main` with a key limited to the screenshot bucket (SL-073, SL-074).
