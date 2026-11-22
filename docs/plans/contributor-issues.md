# Contributor issue edits

Use the titles and bodies below once the revised backlog is on `develop`. Edit each existing issue in place and verify its title, body and backlog link after publication. Preserve the open state, labels, assignments and discussion.

## Issue 185 · Phone-first scorer workspace (SL-050)

**Release.** Phase 6, online match operations. [Backlog and screen sketch](https://github.com/IIITK-Football/super-league/blob/develop/backlog/items/SL-050.md)

**Outcome.** An assigned scorer can run a match and correct a result from a phone. Review the assigned match list and match workspace with the owner before building. Reuse the canonical match events and scoped assignments that already exist. The active Worker baseline must pass before merge. [Offline scoring and invitations](https://github.com/IIITK-Football/super-league/blob/develop/backlog/items/SL-108.md) are a separate assignment.

1. On a phone, sign in as an assigned scorer. Open their match list and see live, upcoming and recent completed matches. Open a match and see teams, score, timer or status and recent events.
2. Record a goal with one tap while the scorer and assist are unknown. See the public score update. Add attribution later and show the updated event and unchanged goal count.
3. Walk through own goals, cards, timer/status, correcting or voiding an event and correcting a final result. Verify visible errors on failed saves. Confirm scoped writes are audited. Verify direct calls fail for unassigned, expired and signed-out users.
4. Use current frontend patterns. Keep the existing scorer and dictator permissions and replace the scorer's old dashboard entry once the dedicated phone workspace covers it.

Attach a phone walkthrough through the real local app, targeted Worker and authorization test results, and screenshots of the assigned list and match workspace. Use the [contributor guide](https://github.com/IIITK-Football/super-league/blob/develop/CONTRIBUTING.md) and open the PR into `develop`. Maintainers handle backlog status, staging and production.

## Issue 186 · Match lineups and starting positions (SL-053)

**Release.** Phase 7, matchday extensions. The season roster and captain assignment prerequisites already exist. [Backlog and screen sketch](https://github.com/IIITK-Football/super-league/blob/develop/backlog/items/SL-053.md)

**Outcome.** An assigned captain prepares a lineup from their own roster. Visitors see the submitted formation and player FUT cards. Review the private lineup editor and public formation together before building.

1. Offer exactly the slots in 5-a-side `1-2-2`, 9-a-side `1-3-3-2` and 11-a-side `1-4-3-3`, counting the goalkeeper first. Reject duplicate, incomplete and wrong-team selections on the server.
2. Let a captain prepare a private draft early. From scheduled kickoff minus 30 minutes until kickoff, the assigned captain can submit or edit. Test both sides of the time boundaries. Dictators can override the lock. A scorer, another team's captain and an ordinary or anonymous user cannot write.
3. Once both teams submit, reveal both publicly with positions, team colors and FUT cards. If one lineup is missing at kickoff, show the submitted lineup with a clear missing state for the other team.
4. If kickoff moves before play, keep already-published lineups visible and recalculate the captain edit window. An out-of-window edit leaves the accepted lineup intact.

Attach results for database and Worker permission and timing tests, and a real local walkthrough with two captains and a visitor. Use the [contributor guide](https://github.com/IIITK-Football/super-league/blob/develop/CONTRIBUTING.md) and open the PR into `develop`. Maintainers handle backlog status, staging and production.

## Issue 187 · Product design system: foundations and primitives (SL-090)

**Release.** Phase 9, frontend redesign. [Backlog and screen examples](https://github.com/IIITK-Football/super-league/blob/develop/backlog/items/SL-090.md)

**Outcome.** A small foundations PR establishes an owner-reviewed visual direction and reusable React/Tailwind building blocks for subsequent redesign assignments.

1. Propose the visual direction with a representative public division page and phone scorer workspace. Show navigation, match controls, loading, empty, error, and keyboard focus states.
2. Document shared tokens and primitives for typography, color, spacing, layout, responsive behavior, states, accessible controls and reduced motion. Show both examples using those foundations.
3. Verify the examples locally at phone, tablet and desktop widths. Include screenshots, keyboard and contrast checks, and component tests for the primitives. Preserve the accepted product flows.
4. Collect owner approval before rollout. Page adoption is assigned to the corresponding [redesign items](https://github.com/IIITK-Football/super-league/blob/develop/backlog/phases.md).

Use the [contributor guide](https://github.com/IIITK-Football/super-league/blob/develop/CONTRIBUTING.md) and open the PR into `develop`. Maintainers handle backlog status, staging and production.
