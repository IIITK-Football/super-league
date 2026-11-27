# Sign-in: Google and college email + password

Users sign in with Google or with a website password. Both require an `@iiitkottayam.ac.in` address, and both end up on the **same Supabase user**, so profiles, roles, predictions and sessions are kept.

## How it works

| Situation | What happens |
|---|---|
| Google user wants a password | While signed in, the profile page ("Website password") calls `supabase.auth.updateUser({ password })`. The user ID does not change. Or use "Forgot password": the emailed link signs them in and sets the password on the same account. |
| Password user later signs in with Google | Supabase links the Google identity to the existing user only when the email on that user is **verified**. Password sign-ups therefore require email confirmation. |
| Signed-in user wants to attach Google explicitly | `linkGoogle()` (`supabase.auth.linkIdentity`) is available in the auth API; local config enables manual linking. |
| Reset | "Forgot password" sends a link to `/reset-password`; the answer is the same whether or not the address has an account. |

Code: `frontend/src/lib/authApi.js` (actions), `authRules.js` (domain and password rules), `pages/Login.jsx`, `pages/ResetPassword.jsx`, `components/PasswordSettings.jsx`.

## Where the college-domain rule is enforced

1. **Frontend**: clear message before any request (`COLLEGE_EMAIL_MESSAGE`).
2. **Backend login route** (`backend/app/api/auth/login`): rejects other domains before contacting Supabase (`backend/lib/auth/collegeEmail.ts`).
3. **Supabase Auth database triggers** (migration `20261117000000_auth_college_domain_and_new_user_triggers.sql`): `ensure_domain_lock` (new accounts) and `ensure_domain_lock_on_email_change` on `auth.users`. This covers every path: Google, password sign-up, admin API, email change. The same migration restores the profile and default-role triggers that a fresh local database was missing.

## Local development

- Email and password work with no Google setup. Start the stack with `pnpm db:start` and open the app at `http://127.0.0.1:5173`.
- Local email (confirmation and reset) goes only to the local Mailpit at <http://127.0.0.1:54324>. No SMTP is configured locally, so nothing leaves your machine.
- New password accounts must confirm their email (click the link in Mailpit). Minimum password length is 8.
- **Google locally (optional):** create a Web OAuth client in Google Cloud with the authorised redirect URI `http://127.0.0.1:54321/auth/v1/callback`, copy `backend/supabase/.env.example` to `backend/supabase/.env` (git-ignored) and fill in the client ID and secret, then restart with `pnpm db:stop && pnpm db:start`. Without credentials `pnpm db:start` passes placeholders so the stack still starts; the Google button then shows that Google is not set up.
- **Turnstile locally:** `pnpm db:start` supplies Cloudflare's published always-pass *test* secret and `frontend/.env.example` has the matching *test* site key, so the widget works out of the box and always passes. To try a real widget, put a real secret in `backend/supabase/.env` (`SUPABASE_AUTH_CAPTCHA_SECRET`) and a real site key in `frontend/.env.local`. Never commit real values.
- Config changes in `backend/supabase/config.toml` (confirmations, redirect URLs, Google provider, Turnstile, rate limit) take effect when the local stack is restarted.

## Bot protection (Cloudflare Turnstile)

Password sign-in, sign-up and reset requests (and the headquarters login) require a Turnstile check. **Supabase Auth verifies the token server-side**, so the secret lives only in Supabase Auth settings and the app never holds it:

- The browser widget (`components/TurnstileWidget.jsx`) appears only when `VITE_TURNSTILE_SITE_KEY` (a public value) is set, and asks for a fresh token after every attempt.
- `authApi.js` sends the token as `captchaToken`. The backend login route (`/api/auth/login`) forwards it. When that route moves to a Cloudflare Worker, the contract is the same and the Worker needs no Turnstile secret.
- **Not covered by this check:** Google sign-in, and changing a password while already signed in.
- Future custom endpoints (for example registration forms) verify a token with Cloudflare's siteverify using a Worker secret (`wrangler secret`, with `.dev.vars` kept out of Git). That is not built yet.
- Without a site key nothing extra is sent, which only works while CAPTCHA is off in Supabase. To roll back: turn CAPTCHA off in Supabase, then remove the site key.

Tests: `pnpm test:group auth-identity` (unit tests for the rules, and integration tests against the local Auth service for same-user password setup, recovery, duplicate sign-up, domain rejection, and Mailpit delivery).

## Changing a password needs reauthentication (older sessions)

Supabase's *Secure password change* is on locally (`secure_password_change = true`). A signed-in user whose session is under 24 hours old can set or change a password directly. On an older session, saving a password emails a one-time code to their college address; they enter it in the same form (`components/PasswordSettings.jsx`, `authApi.setPassword(password, code)` and `requestPasswordChangeCode()`), and it is sent to Supabase as the `nonce`. A reset link counts as a fresh sign-in and needs no code. This protects against a stolen or left-open session silently setting a password.

## Google sign-in settings per environment

Google sign-in is a browser-to-Supabase flow: the browser calls the project's Auth, Auth sends it to Google, Google returns to the **project's** `/auth/v1/callback`, and Auth then redirects to the app. The API Worker is not involved. Each environment has its **own** Supabase project, Google OAuth client, Site URL and redirect list; never share or reuse one across environments.

| | Local | Staging (develop) | Production |
|---|---|---|---|
| Supabase project | local stack, `http://127.0.0.1:54321` | `super-league-staging` | the original project |
| App address | `http://127.0.0.1:5173` | `https://develop.super-league.pages.dev` | `https://super-league.pages.dev` |
| Site URL and redirect URLs | `config.toml` (`site_url`, `additional_redirect_urls`) | Dashboard → Authentication → URL Configuration: Site URL and `https://develop.super-league.pages.dev/**` | Dashboard, as in the section below |
| Google client | a local-only client; id and secret in git-ignored `backend/supabase/.env` | a separate non-production client, set in Dashboard → Providers → Google | the production client (unchanged) |
| Google "Authorised redirect URI" | `http://127.0.0.1:54321/auth/v1/callback` | `https://<staging-ref>.supabase.co/auth/v1/callback` | `https://<production-ref>.supabase.co/auth/v1/callback` |
| Frontend points at it via | `frontend/.env.local` | Cloudflare Pages **Preview** build variables | Cloudflare Pages **Production** build variables |

`node scripts/check-google-oauth.mjs <project-url>` shows, read-only and without printing any credential, whether Google is enabled on a project, the *shape* of its client id, and whether the callback belongs to that project.

### Troubleshooting Google sign-in
- **Google shows `Error 401: invalid_client` ("OAuth client was not found")**: the project sent Google a client id Google does not know. Locally this means `backend/supabase/.env` has no real `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` / `_SECRET`. `pnpm db:start` now switches Google off in that case (the button says it is not set up); add both values to enable it. On a hosted project, check Providers → Google has that environment's own client id and secret.
- **After Google you land on `http://localhost:3000/?error=invalid_request&error_code=bad_oauth_state`**: Auth could not find the sign-in attempt (it was already used, expired, or handled by another project), so it fell back to the project's **Site URL**, which is still the default `http://localhost:3000`. Set the project's Site URL and redirect URLs (above), make sure the frontend build points at that same project, and retry once in a fresh tab without using back, refresh or a second click. Supabase dashboard → Logs → Auth shows the `bad_oauth_state` entry.

## Production: dashboard changes for the owner to apply

This repository does not change hosted Supabase. Please check or apply these in the Supabase dashboard (Authentication) yourself:

1. **Providers → Email**: enabled, with **Confirm email** turned **on**. Without it, an unverified password sign-up could claim an address before its owner uses Google, and Supabase will not safely link such identities.
2. **Minimum password length**: 8 (the app also requires 8).
3. **URL Configuration**: Site URL set to the production site; add redirect URLs for `<site>/login`, `<site>/reset-password` and `<site>/profile` (and the Pages preview domain if used).
4. **Email delivery**: keep the existing hosted SMTP/email configuration; confirm the *Confirm signup* and *Reset password* templates link to the Site URL.
5. **Providers → Google**: already configured; no change needed. Optionally enable *Allow manual linking* if you later expose the "connect Google" button.
6. **Database**: the migration above is idempotent. Production already has `ensure_domain_lock`, `on_auth_user_created` and `on_auth_user_role_created`; the migration replaces them with the same names and a stricter (case-insensitive, exact-domain) check. Apply it only through the approved release process.

7. **Secure password change**: turn it **on** (Authentication → Providers → Email). The app already handles the emailed code, but if the setting stays off in production the code step is simply never requested.

Existing users are not touched by any of this. Nothing here deletes or recreates a user.

### Read-only checks to run on the hosted project first (Supabase SQL editor)

```sql
-- Triggers currently on auth.users (names and definitions)
select tgname, pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;
-- Existing definitions, to restore exactly if they differ from the baseline versions
select pg_get_functiondef('public.enforce_college_domain()'::regprocedure);
select pg_get_functiondef('public.handle_new_user()'::regprocedure);
-- Accounts outside the college domain (these could not use the HQ login after this change)
select id, email from auth.users where email is null or email !~* '^[^@[:space:]]+@iiitkottayam\.ac\.in$';
```

Also confirm the Cloudflare Pages build (production and previews) defines `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (see [`environment.md`](environment.md)); the app now stops with a clear message if either is missing instead of using dummy values.

### Turnstile: settings for the owner to prepare (nothing here is done by the repository)

1. In Cloudflare, create a Turnstile widget whose allowed hostnames include the production site and any preview domains. Keep the **secret key** private for step 4; the **site key** is public.
2. In Cloudflare Pages, add `VITE_TURNSTILE_SITE_KEY` (the site key) for production and previews, then **redeploy**. `VITE_*` values are baked in at build time, so the key only takes effect in a new deployment.
3. Confirm the widget is visible on `/login` and `/hq-login` in production. A site key without CAPTCHA enabled does no harm; sign-in keeps working.
4. **Only then**, in Supabase (Authentication → Attack Protection), enable CAPTCHA with provider Turnstile and enter the secret key. Supabase needs the secret to enable it, so "secret configured" and "CAPTCHA enabled" are one action.

**CAPTCHA must not be enabled in production until both the Supabase secret and the deployed Pages site key are in place.** Enabling it earlier rejects every password sign-in that has no token, including the headquarters login on the current production build. Emergency rollback: switch CAPTCHA off in Supabase first (instant); the site key can stay.

The headquarters login and the password pages are covered; Google sign-in is not affected.

## Verifying the release safely (staging first)

Production is the original hosted Supabase project, and (as far as we know) the free plan has no backup to restore from. Rehearse the risky steps on a separate staging project, then do only a small smoke check in production. Everything here is an owner action; the repository never touches hosted services except through the GitHub Actions workflow described in [`release.md`](release.md).

**What staging can prove that local tests cannot:** the migration runs with hosted permissions, real Turnstile verification (local uses Cloudflare's always-pass test secret), real email delivery, secure password change with a real emailed code, and the CAPTCHA on/off and rollback rehearsals, all with no real user affected. **What it cannot prove:** production's own current settings and data, which the read-only checks and the production smoke cover.

### Staging runbook
1. Create a new free Supabase project, name it clearly as staging, and **leave it empty**.
2. Set up the GitHub environments and secrets from [`release.md`](release.md) and push `develop`. The workflow applies the baseline, `20261117000000_auth_college_domain_and_new_user_triggers.sql` and the later migrations (see `release.md`) to staging, plus the synthetic seed; you do not paste SQL. (If you already applied SQL to staging by hand, say so before pushing: the migration history must then be repaired first.) Move your CLI link to staging as described there; never link to production.
3. Set the Auth settings above on staging by hand (CI deploys the database, not Auth settings): Confirm email on, minimum password length 8, Secure password change on, redirect URLs including `http://127.0.0.1:5173/**`, SMTP (or the default sender to your own team address), Google not needed.
4. Add `localhost` and `127.0.0.1` to a Turnstile widget's hostnames. Enter its secret only in staging's Supabase CAPTCHA setting, and put its site key in `frontend/.env.staging.local` (git-ignored, so your `.env.local` for the local stack stays unchanged).
5. Put the staging URL and **publishable** key in `frontend/.env.staging.local` too (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`), with `VITE_ALLOW_REMOTE_SUPABASE=true` (the app refuses a non-local Supabase URL in development without this opt-in), and run the app with `pnpm exec vite --mode staging` from `frontend/`. Keep these only in ignored local files, and never put the database password or a secret key there.
6. Work through the checks below. When they pass, delete `.env.staging.local`. Keep the staging project: CI deploys to it from `develop` (resume it if it pauses).

### Checks on staging (expected result in brackets)
| Check | Expected |
|---|---|
| Triggers on `auth.users` after the migration | `ensure_domain_lock`, `ensure_domain_lock_on_email_change`, `on_auth_user_created` (the default-role trigger was removed with the role grants, 20261201000000) |
| Sign up with a non-college email | Rejected |
| Sign up with a college address | Needs the emailed confirmation; a profile appears after it (a normal user holds no role grant) |
| Password sign-in with the widget | Succeeds |
| Password sign-in with no token (for example by blocking the widget script) | "The verification did not complete" |
| Forgot password | Email arrives; its link opens `/reset-password`; the new password works |
| Set a password from the profile on a fresh session | Saves directly |
| Same, on a session older than 24 hours | Emails a code, then saves with the code |
| Turn CAPTCHA off, then on again in staging | Password sign-in works while off, and with a token while on |
| Apply `docs/rollback/auth-college-domain-rollback.sql` | Domain check relaxed to the previous version; new accounts still get a profile and role |

### Production smoke test afterwards (no new accounts)
After the approved release steps: the widget is visible on `/login` and `/hq-login`; one password sign-in with an existing account of yours works; one reset email to your own address arrives from your sender and its link lands on the production site; Google sign-in still opens. These cover what staging cannot: the production SMTP sender, redirect lists and the Pages variable. If you prefer a dedicated production test account, create it only at this point with the default (non-privileged) role, and delete it afterwards.

## Release order and rollback

Order (each step needs your approval; database changes go through GitHub Actions, see [`release.md`](release.md)):

1. The free plan has no backup to restore from, so take the **manual production export** (and save the hosted function and trigger definitions from the checks above) immediately before the first production run, then repair the migration history as described in `release.md`.
2. Apply the dashboard settings above (Confirm email, SMTP, URLs, password length).
3. Merge `develop` into `main`: the `production` job applies migration `20261117000000_auth_college_domain_and_new_user_triggers.sql` and the later migration listed in `release.md` after you approve it in GitHub (they were already applied to staging from `develop`).
4. Add the Turnstile site key to Pages, deploy the frontend and backend, and confirm the widget is visible (see the Turnstile steps above). CAPTCHA stays **off** in Supabase until this is confirmed.
5. Enable CAPTCHA in Supabase with the Turnstile secret (the only step that can block password sign-ins; switch it off first if anything goes wrong).
6. Verify with a college test account (password sign-up and confirmation, reset, setting a password from the profile, and the emailed code on an older session). Do the full rehearsal on the staging project first (see above). In production only the small smoke test remains: Pages previews use the production project, so use an existing account of yours rather than creating new ones. Google sign-in is already live and is not retested.

Rollback:

- **Database:** forward-fix only. `docs/rollback/auth-college-domain-rollback.sql` restores the previous domain check and profile function and drops only the new email-change guard; it deliberately keeps the domain, profile and role triggers. It changes no rows, and a test applies it to the local database inside a transaction that is rolled back. If the hosted definitions differ from the baseline, restore the ones you saved in step 1 instead.
- **Frontend and backend:** redeploy the previous build. The previous build still works with the new triggers.
- **Dashboard settings:** revert them individually. Accounts created while Confirm email was on stay valid.
