# API Worker: staging deploys (Cloudflare Workers Builds)

The Hono API Worker (`api/`) reaches staging in exactly one way: **Cloudflare Workers Builds**, connected to the
`super-league-api-staging` Worker and this repository's `develop` branch. Nothing deploys the production Worker
before the approved release (`docs/release.md`).

## Build settings (Cloudflare dashboard → Workers & Pages → super-league-api-staging → Settings → Build)
| Setting | Value |
|---|---|
| Git repository | `IIITK-Football/super-league` |
| Branch (production branch of this Worker) | `develop` |
| Builds for non-production branches | **Off** (no preview uploads from other branches) |
| Root directory | `/` (repository root: the Worker bundles shared handlers from `backend/`, so the whole workspace is installed) |
| Build command | *(empty)* |
| Deploy command | `node api/scripts/deploy-staging.mjs` |
| Build watch paths | include `api/*`, `backend/app/api/*`, `backend/lib/*` |
| Build variables | `NODE_VERSION=24` |

Workers Builds installs dependencies at the root from `pnpm-lock.yaml` (pnpm comes from `packageManager` in
`package.json`). The deploy command (`api/scripts/deploy-staging.mjs`) refuses unless it runs inside Workers Builds
(`WORKERS_CI=1`), on `develop`, with a configuration whose `env.staging` is `super-league-api-staging` and carries the
production project's reference. It then type-checks and runs `wrangler deploy --env staging`.

## Runtime settings (… → super-league-api-staging → Settings → Variables and Secrets)
Add these as **Secrets** (encrypted), staging values only. Secrets survive deploys; plain-text variables set in the
dashboard are replaced by `wrangler.jsonc` on every deploy, so do not use them.

| Secret | Value |
|---|---|
| `SUPABASE_URL` | the staging project URL (`https://yecozsiccsfwphlmxozt.supabase.co`) |
| `SUPABASE_PUBLISHABLE_KEY` | staging publishable key |
| `SUPABASE_SECRET_KEY` | staging secret key |

`SL_ENVIRONMENT=staging` and `SL_PRODUCTION_SUPABASE_REF` come from `wrangler.jsonc`. The Worker refuses every
request (503) if `SUPABASE_URL` is missing or contains the production reference.

## Checking a deploy
- The build log ends with `Deployed super-league-api-staging` and the deployment lists the `develop` commit.
- The served pair: `/version.json` names the site's commit and `/api/health` the Worker's commit and version.
  `node scripts/staging-routing-check.mjs` checks the same-origin `/api` contract (bearer forwarding, errors, no-store)
  and records both. Rolling back the pair: [docs/rollback/pages-worker-pair.md](rollback/pages-worker-pair.md).
- The Worker has no public URL; once the staging Pages project has its `API` service binding, `GET /api/health` on
  the staging site returns `{"ok":true,"service":"super-league-api","environment":"staging"}`.

## Automated staging checks behind Cloudflare Access
The staging site (`*.super-league.pages.dev` previews) is protected by Cloudflare Access. Scripted checks reach it with
a **service token** that is allowed only on the preview hostnames, never the production site.

One-time setup (owner):
1. Zero Trust → Access → Service credentials → Service tokens → Create a service token named `sl-staging-checks`.
   Copy the Client ID and Client Secret; the secret is shown only once.
2. Zero Trust → Access → Applications → the application protecting the Pages previews → add a policy with Action
   **Service Auth** that includes the `sl-staging-checks` token. Do not add it to any production application.
3. Store both values in the macOS Keychain with hidden input (nothing reaches the repository or a chat):
   `security add-generic-password -U -a "$USER" -s sl-staging-access-client-id -w` and
   `security add-generic-password -U -a "$USER" -s sl-staging-access-client-secret -w`

Run: `node scripts/staging-media-check.mjs` uploads a portrait, a team logo and a news image through the staging site,
checks each lands in its `sl-staging-*` bucket and serves the image, checks a normal account is refused, and cleans up.
Revoke the token in Zero Trust to stop all automated access at once.
