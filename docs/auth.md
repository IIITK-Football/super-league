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
- Config changes in `backend/supabase/config.toml` (confirmations, redirect URLs, Google provider, rate limit) take effect when the local stack is restarted.

Tests: `pnpm test:group auth-identity` (unit tests for the rules, and integration tests against the local Auth service for same-user password setup, recovery, duplicate sign-up, domain rejection, and Mailpit delivery).

## Production: dashboard changes for the owner to apply

This repository does not change hosted Supabase. Please check or apply these in the Supabase dashboard (Authentication) yourself:

1. **Providers → Email**: enabled, with **Confirm email** turned **on**. Without it, an unverified password sign-up could claim an address before its owner uses Google, and Supabase will not safely link such identities.
2. **Minimum password length**: 8 (the app also requires 8).
3. **URL Configuration**: Site URL set to the production site; add redirect URLs for `<site>/login`, `<site>/reset-password` and `<site>/profile` (and the Pages preview domain if used).
4. **Email delivery**: keep the existing hosted SMTP/email configuration; confirm the *Confirm signup* and *Reset password* templates link to the Site URL.
5. **Providers → Google**: already configured; no change needed. Optionally enable *Allow manual linking* if you later expose the "connect Google" button.
6. **Database**: the migration above is idempotent. Production already has `ensure_domain_lock`, `on_auth_user_created` and `on_auth_user_role_created`; the migration replaces them with the same names and a stricter (case-insensitive, exact-domain) check. Apply it only through the approved release process.

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

Also confirm the Cloudflare Pages build (production and previews) defines `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; the app now stops with a clear message if either is missing instead of using dummy values.

## Release order and rollback

Order (each step needs your approval; nothing here is automated yet):

1. Record a backup or point-in-time-recovery point, and save the hosted function and trigger definitions from the checks above.
2. Apply the dashboard settings above (Confirm email, SMTP, URLs, password length).
3. Apply migration `20261117000000_auth_college_domain_and_new_user_triggers.sql` through the approved release process.
4. Deploy the frontend and backend.
5. Verify with a college test account in an isolated Auth environment (password sign-up and confirmation, reset, Google sign-in linking). Never use production as the test target.

Rollback:

- **Database:** forward-fix only. `docs/rollback/auth-college-domain-rollback.sql` restores the previous domain check and profile function and drops only the new email-change guard; it deliberately keeps the domain, profile and role triggers. It changes no rows, and a test applies it to the local database inside a transaction that is rolled back. If the hosted definitions differ from the baseline, restore the ones you saved in step 1 instead.
- **Frontend and backend:** redeploy the previous build. The previous build still works with the new triggers.
- **Dashboard settings:** revert them individually. Accounts created while Confirm email was on stay valid.
