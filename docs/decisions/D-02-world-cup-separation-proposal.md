# D-02 proposal: World Cup separation from division fantasy

Status: **resolved by the owner 2026-11-19; see `D-02-world-cup-separation.md`, which takes precedence**. World Cup is frozen; this proposal is not an implementation instruction.

## 1. Current state
- **Onboarding forces a World Cup choice.**
  - `frontend/src/App.jsx:43`: `ProtectedRoute` shows `<Onboarding />` unless both `nickname` and `wc_team_flair` are set. This blocks `/fantasy`, `/leaderboard` and `/profile`.
  - `Onboarding.jsx` requires a World Cup country, saves it through `PATCH /wc/flair`, then upserts `user_profiles`.
- **The division profile requires it too.** `UserProfile.jsx` requires and saves `wc_team_flair` next to the per-division flairs.
- **World Cup runs inside the division fantasy page.**
  - `App.jsx` (`WcRoute`) sets `fantasySection='fifa'` and renders `Fantasy.jsx`, which renders `<FifaPrediction />` and its own onboarding blocker.
  - The navbar labels `/wc` as "Fantasy".
- **The World Cup page sends users to the division profile.** `FifaPrediction.jsx:475-478` redirects to `/profile` to choose a flair.
- **Data.**
  - `user_profiles` holds `nickname`, `wc_team_flair` and an unused `team_flair_id`.
  - World Cup tables are `wc_*`; `division_flairs(user_id, division_id, team_name)` is per division.
  - The World Cup leaderboard joins `user_profiles(nickname, real_name, wc_team_flair)`.
- **Security gap.** `backend/app/api/wc/flair/route.ts` takes `user_id` from the request body and writes with the secret key, without authentication (also listed in SL-025).

## 2. Options
| | A. Light separation (recommended) | B. A separate World Cup profile table | C. Status quo |
|---|---|---|---|
| World Cup data model | unchanged | moves `wc_team_flair` | unchanged |
| Onboarding | nickname only | nickname only | requires World Cup |
| World Cup code touched | entry point, flair prompt, one redirect | leaderboard query, page, migration | none |
| Risk | low | changes World Cup data (against CLAUDE.md) | fails SL-043 |

## 3. Recommendation (A)
**Shared by both domains:**
- Supabase Auth and `AuthContext`;
- the role model;
- the `user_profiles` basics: `id`, `email`, `real_name`, `nickname`;
- UI building blocks;
- the Worker shell (D-05: World Cup is an isolated module).

**World Cup only:**
- all `wc_*` tables and `wc_team_flair` (unchanged, on `user_profiles`);
- sync, grading, awards, knockouts and leaderboard;
- the `/wc` page.

**Division only:**
- season fantasy configuration and scoring (SL-043);
- `division_flairs`;
- season fantasy points and leaderboard.

**Changes:**
1. **Onboarding.** `ProtectedRoute` checks `nickname` only, and onboarding drops the World Cup select and the `/wc/flair` call.
2. **World Cup first-visit prompt.**
   - A `WcFlairPrompt` inside the World Cup page appears on `/wc` when a signed-in user has no `wc_team_flair`.
   - It saves through an **authenticated** `/wc/flair`: the user comes from the token, and the body's `user_id` is ignored. This is the narrow, separately verified World Cup backend fix.
   - `FifaPrediction.jsx` opens this prompt instead of navigating to `/profile`. That is the only change to World Cup page logic.
3. **Route decoupling.**
   - `/wc` renders a thin `WorldCupPage` (shell, prompt gate, `<FifaPrediction />`). Visible behaviour stays the same.
   - `Fantasy.jsx` loses its World Cup branch.
4. **Navigation.** "Fantasy" goes to the selected division's fantasy section. World Cup is reached from the home entry (SL-060).
5. **Profile.** Remove the World Cup requirement from `UserProfile.jsx`.
6. **Per-division fantasy profile.**
   - Extend `division_flairs` with a nullable `nickname`; no rename, so no data is lost.
   - The name shown on division leaderboards is `coalesce(division nickname, account nickname)`. The account nickname stays what World Cup uses.

**Untouched:** the `wc_*` schema and data, grading, World Cup leaderboard queries, scoring, and `wc_team_flair`.

**Checks:**
- A new user onboards without World Cup fields.
- An existing World Cup user's flair, points and history are unchanged; compare `wc_*` row counts before and after.
- `/wc/flair` refuses to write another user's row.

## 4. Questions for the owner
1. Keep a nickname required at onboarding? **Default: yes.**
2. Let a World Cup user with no flair browse `/wc`, with the prompt blocking only saving predictions? **Default: yes.**
3. Approve the authenticated `/wc/flair` fix as the single World Cup backend change in SL-043? **Default: yes,** tested separately.
4. Keep a direct "World Cup" link in the navbar? **Default: no.** Home content only (SL-060).
5. Make the division nickname optional, falling back to the account nickname? **Default: yes.**
6. Drop the unused `user_profiles.team_flair_id`? **Default:** in the Phase 10 legacy sweep, after a production null-count check.

## Owner answers

- **2026-11-19, separation boundary:** freeze World Cup feature work and preserve its existing behavior/data. Its only route is `/wc`; a home-carousel link may be added later as ordinary home content. Division fantasy is independent and shows the selected division's current season.
- **2026-11-19, onboarding:** keep the current onboarding behavior; no onboarding or flair flow changes are part of division fantasy work.
