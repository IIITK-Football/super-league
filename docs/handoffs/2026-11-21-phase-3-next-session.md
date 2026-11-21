# Handoff for Phase 3 — Worker runtime verification

## Branch and baseline

- Preparation branch is `codex/work`. Review the documentation commits on that branch for integration into the next implementation checkout. The release base is `2babc0ff6d29e96f726031ede51a50f16b83e1ad`, the merge of [PR #191](https://github.com/IIITK-Football/super-league/pull/191).
- The primary checkout was on `develop` at the release base. Its unrelated untracked directories and the Codex checkout's local `AGENTS.md` edit were left in place.
- SL-026 closed Phase 2. The [compatibility baseline](../contracts/worker-compatibility.md) records 44 explicit Worker operations across 33 paths. Its [clean-tree evidence](../../backlog/evidence/SL-026.json) records 13 passing active groups, including 87 API tests. [Develop CI](https://github.com/IIITK-Football/super-league/actions/runs/44900141436) passed on the Phase 2 feature tip.
- All 12 Phase 3 workflow statuses remain `not-started`. The dispositions below describe implementation progress. Prior release and staging evidence is cited on the items. The reconciliation made no application, database, environment, or deployment change.

## Phase 3 dispositions

| Item | Disposition | Evidence and remaining work | Difficulty |
| --- | --- | --- | --- |
| [SL-029](../../backlog/items/SL-029.md) | Partial | Historical measurements and prototype exist. D-05 settled topology. Measure the staging Worker, optimize if needed, verify parity, and retain both owner checks. | Medium |
| [SL-030](../../backlog/items/SL-030.md) | Partial | Hono runtime, Auth tests and deploy guards exist. Verify actual Wrangler execution, identity and transaction rules, and timing and credential requirements under D-04. | Medium–high |
| [SL-031](../../backlog/items/SL-031.md) | Partial | Pages and Vite forward the API. Verify actual local/staging routing, authorization headers, errors and cache behavior. Document prior-release rollback. | Low–medium |
| [SL-032](../../backlog/items/SL-032.md) | Partial | The mounted surface and selected routes are documented and tested. Close per-group parity and cutover checks, including saved World Cup brackets and HLS carousel playback. | High |
| [SL-034](../../backlog/items/SL-034.md) | Partial | Worker handlers serve supported routes and the Next runtime remains. Verify deployment ownership and rollback, then retire the obsolete runtime. | High |
| [SL-070](../../backlog/items/SL-070.md) | Not started | Storage purposes are known. Inventory every object, owner and reference, and produce a reviewed rename and collision report. | High |
| [SL-071](../../backlog/items/SL-071.md) | Partial | Three upload purposes use shared storage and server-generated keys. Complete the storage operation map and add bound HLS reads. | Medium–high |
| [SL-072](../../backlog/items/SL-072.md) | Partial | Wrangler emulates three upload buckets. Add deterministic resettable fixtures and verify actual emulation and offline playback. | Medium |
| [SL-073](../../backlog/items/SL-073.md) | Partial | Environment-specific upload buckets and the screenshot branch guard are in place. Prepare staging media and verify each approved cutover, including objects, hostnames, references and rollback. | High |
| [SL-074](../../backlog/items/SL-074.md) | Not started | Backup access is separately documented. Prove least privilege, replacements and revocations after approved cutovers. | Medium–high |
| [SL-104](../../backlog/items/SL-104.md) | Not started | SL-042 supplies the existing portrait and preferred-foot editor. The expanded edit, protected-field denials, audit and real app walkthroughs remain. | High |
| [SL-105](../../backlog/items/SL-105.md) | Not started | The icon host remains hard-coded. Add environment config, fallback, source checks, and staging verification. | Low–medium |

## Decisions and blockers

- SL-030 can start independently of SL-029. SL-029 owns the current staging dashboard measurements and any focused optimization. SL-030 records the accepted D-04 evidence and leaves failures open.
- Verify Worker route groups in SL-032 independently of the full storage migration. SL-105 depends on the SL-071 environment map. SL-072 also depends on SL-105 so local icon coverage can use that configuration.
- The reported home carousel playback failure stays open. Current Wrangler config has no video binding. SL-071 adds `R2_VIDEO` with `sl-local-intro`, `sl-staging-intro`, and production `intro`, and replaces the URL-based proxy read. Pages keeps its Worker binding. SL-072 supplies local HLS fixtures. A real playlist, its referenced segments, and browser playback across a carousel transition must pass through the Worker. Record content types and Range behavior.
- Staging bucket setup and population are recorded under SL-073 and still require owner authorization. This preparation supports SL-032 staging playback verification before production cutover. SL-073 production cutovers remain gated on parity, inventory, local emulation, staging verification, and owner approval. Restore a prior compatible Worker and Pages release for rollback, with its required objects preserved.

## Start in the next session

1. Integrate the published documentation with the implementation checkout after owner review. Check the worktrees, branch and `pnpm work status`. Preserve local files and coordinate port 54322 with the other checkout.
2. Read the [SL-030 implementation plan](../plans/SL-030.md) and [D-04](../decisions/D-04-workers-supabase-access.md). Take SL-030 through the normal backlog start command in that session. Start with local runtime and authorization evidence, including actual Wrangler execution and the real Auth/Data API.
3. Obtain the owner-approved staging access path or ask the owner to run the checks. Record the deployed SHA, Pages origin and Worker environment, then collect health, scoped response and timing evidence. An authorized placement comparison and attestation remain owner actions. Keep hosted operations within their documented approval boundary.
4. Stop on an unidentified runtime or database, missing authorization, failed acceptance check, or unresolved D-04 discrepancy. Record the specific check and evidence still required. Keep carousel work and credential rotation in their respective items.

## Verification for this documentation handoff

- `pnpm work status` reported 13 done, 10 legacy-done and 38 not-started. `pnpm work check --base HEAD` passed for 61 items, `pnpm work audit --repo` passed all eight checks, and `git diff --check` passed.
- The changed-file check verified the 12 Phase 3 item records, `CLAUDE.md`, `backlog/phases.md`, `backlog/overview.md`, `docs/plans/SL-029.md`, `docs/plans/SL-030.md`, and this handoff. The full dependency graph is acyclic, all 61 workflow statuses match the release base, and all new relative links resolve. Existing generated evidence remains unchanged.
- These checks validate the documentation changes. Runtime, staging, and production acceptance gaps remain in the item records above.
