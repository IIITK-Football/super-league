# Rolling back the site and its API Worker together

The browser reaches the API on the same origin: Pages serves the site and forwards `/api/*` through its `API` service binding to the Worker. A release is therefore a **pair**:

- the Pages deployment, named by `/version.json` (`commit`, `branch`, `builtAt`);
- the Worker version, named by `/api/health` (`commit`, `version`).

The `/api` contract is kept compatible between releases (SL-031), so a site and a Worker from neighbouring releases work together. A rollback restores the last pair known to work and then repeats the same requests.

## When

A release breaks the site or the API on staging (or, with the owner's approval, production), and fixing forward is slower than restoring.

## Steps (owner, Cloudflare dashboard)

1. **Record the pair now being served**, before changing anything:
   - `node scripts/staging-routing-check.mjs > before.json`, or open `/version.json` and `/api/health` on the site.
   - The `release` field holds both commits.
2. **Choose the pair to restore:**
   - the last pair whose `scripts/staging-routing-check.mjs` evidence passed;
   - for the item records, the evidence files in `docs/walkthroughs/evidence/`.
3. **Roll back the Worker:** Workers & Pages → `super-league-api-staging` (or `super-league-api` in production) → Deployments, then "Rollback" on the version whose id matches the chosen `/api/health` `version`.
   - A rollback deploys that version's code and settings as they were.
   - Secrets are unchanged.
4. **Roll back the site:** Workers & Pages → the Pages project → Deployments, then "Rollback to this deployment" on the deployment built from the chosen commit (`develop` previews for staging).
   - The `API` binding is a project setting, so the restored deployment still forwards `/api` to the Worker.
5. **Repeat the requests:** run `node scripts/staging-routing-check.mjs`. It must pass with `release.site.commit` and `release.worker.commit` showing the restored pair.
6. **Return to the newest release** once it is fixed, by pushing the fix to `develop` (Workers Builds and Pages both deploy it). Then run the check again.

## Notes

- Database migrations are forward-only and are not rolled back with the code (see `docs/release.md`). A release whose code needs a new migration is compatible with the previous code only if that migration is additive. Every migration in Phase 3 is additive (new functions only).
- `wrangler.jsonc` is the source of truth for Worker settings, so the next deploy from `develop` replaces whatever the rollback restored.
- Production rollbacks follow the same steps and are the owner's to approve and perform.
