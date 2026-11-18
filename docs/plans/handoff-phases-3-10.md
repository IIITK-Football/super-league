# Planning handoff: Phases 3–10

**Status:** draft, 2026-11-18. Read-only research by four independent agents (Phase 3, Phase 4, Phases 5–6, Phases 8–10), consolidated here. Nothing was implemented and no decision was taken.

Phase 2's remaining items already have draft plans: `SL-022`, `SL-024`, `SL-025`, `SL-026` and `SL-042`. **Nothing below can start yet**: the `pnpm work` phase gate holds every later phase until Phase 2 is done. "Ready to plan" means a full plan could be written now.

The Phase 3 notes take the owner's uncommitted edits to `backlog/phases.md` and `SL-030.md` (SL-029 first) as the owner's intent.

## Decisions that block planning
| Decision | Blocks | Proposal |
|---|---|---|
| D-03 roles and assignments | SL-024 → SL-022, SL-050, SL-053 | `docs/decisions/D-03-…` |
| D-08 score and goal events | SL-022 → SL-046, SL-050, SL-054, SL-063 | `D-08-…` (highest rework risk) |
| D-04 Worker Supabase access, D-05 topology | SL-030, SL-031, SL-032 | `D-04-…`, `D-05-…` (D-05 recommends no gateway Worker, which shrinks SL-031) |
| D-06 domains and buckets | SL-073, SL-074, SL-075, SL-060/061 media | `D-06-…` (9 questions) |
| D-02 World Cup separation | SL-043 → SL-060 | `D-02-…` (6 questions) |
| D-07 home video, D-11 home sections | SL-060, SL-093 | `D-07-…`, `D-11-…` |
| D-09 external results | SL-063 | `D-09-…` (default: defer until a provider is named) |
| D-10 code ownership | SL-081 | `D-10-…` (also needs Ebin's and Abhinav's GitHub handles) |

## Phase 3: Workers backend and storage
**Proposed order:**
1. SL-029.
2. Owner resolves D-04 and D-05.
3. SL-030, with SL-070 alongside.
4. SL-031 (likely just same-origin routing) and SL-071, then SL-072.
5. SL-032.
6. Owner resolves D-06 (any time after SL-070).
7. SL-073, one bucket at a time in the D-06 order.
8. SL-074.
9. SL-034 last.

| Item | Ready to plan | Key checks |
|---|---|---|
| SL-029 latency and topology | **yes** (plan exists; needs the owner's staging baseline and target) | warm target met with the response unchanged; no production used |
| SL-030 Worker runtime | no (D-04, D-05) | local Worker reaches only local Supabase; token checks tested; no Cloudflare credential committed |
| SL-031 gateway | no (D-05) | browser path tested (same-origin or deliberate CORS) |
| SL-070 storage inventory | mostly | every R2 reference classified; the `backup` writer found; backup stays private |
| SL-071 / SL-072 storage interface, local R2 | after SL-070 / SL-071 | no route builds its own R2 client; no request reaches production R2 locally |
| SL-032 parity port (54 handlers) | no | contract and authorization tests per route group; the existing frontend still works |
| SL-073 / SL-074 buckets, domain, credentials | no (D-06) | counts, checksums and sampled reads match; no row references a retired host; owner approval per production step |
| SL-034 retire Next | no | every route goes through the Worker; rollback tested |

**Recommendations for the owner:**
- Make SL-034 depend on SL-073 and SL-074 (the media proxy must outlive the cutover).
- Decide whether SL-070 may start before SL-030.
- Add D-05 to SL-029's `decisions`.

## Phase 4: division and season capabilities
**Order:**
1. SL-040 and SL-047 together.
2. SL-044.
3. SL-043, after D-02.
4. SL-045.
5. SL-046.

| Item | Ready to plan | Key checks |
|---|---|---|
| SL-040 configuration and navigation (root) | yes | hide and reorder can be undone and survive a cache refresh; no direct-write policy left; every change audited |
| SL-047 sign-in allowlists | yes | the default matches today's domain rule; password and Google sign-up are both enforced on the server; user ids unchanged |
| SL-044 rules builder | yes | a published version never changes; nothing reads `rules_md` any more |
| SL-043 division fantasy, World Cup decoupled | no (D-02) | `wc_*` row counts unchanged; `/wc/flair` refuses other users |
| SL-045 registration | mostly | returning players aren't asked again; a bad regex is rejected on the server; the accepted rules version is stored; a full registration goes to the waitlist |
| SL-046 exports and integrity | partly (D-08) | exports reconcile with dashboard totals; non-dictators get 403 |

**Owner questions:**
- **SL-045:** duplicate submissions, leaving the waitlist, who may register a team.
- **SL-047:** what removing a domain does to existing accounts.
- **SL-046:** is CSV enough?

## Phases 5–6: match operations, home, sharing, integrations
**Phase 5 order:** SL-053 and SL-054 in parallel, then SL-050. SL-050 could go first if live scoring is the priority, and is large enough to consider splitting.

**Phase 6 order:** SL-060 and SL-061 (SL-061 after SL-054's stages), then SL-063 last or deferred.

| Item | Ready to plan | Key checks |
|---|---|---|
| SL-053 lineups | close (lock policy) | exact slot counts per format; edits after lock rejected; captains cannot change the player list |
| SL-054 formats and brackets | no (SL-040, SL-022) | reordering matches keeps the bracket; a result correction recomputes and is audited; no format branch left in the frontend |
| SL-050 scorer workspace | no (D-08, D-03) | a replayed queued action applies once; pending changes survive a reload offline; conflicts are shown, never overwritten |
| SL-060 home configuration | no (D-07, D-11, D-02, D-06) | no R2 host or clip id in source; hiding never deletes |
| SL-061 sharing and Open Graph | no (SL-054) | zero, one or several live matches resolve to one predictable target; no private fields in previews |
| SL-063 external adapters | no (D-09) | a re-run import changes nothing; manual edits always win |

**Owner questions:**
- **Lineups:** may a dictator edit after the lock, and is kickoff the hard lock?
- **Scorer invitations:** how long do they last?
- **Sharing:** what's the fallback when no match is live or next?

## Phases 8–10: repository policy, redesign, cutover
**Phase 8:**
- **SL-080 migration automation:** the code exists; C4 remains, the owner's production baseline step.
- **SL-081 CODEOWNERS:** after D-10 and the contributor handles.
- **SL-082 contributor docs:** after SL-034 and SL-074; fix `CONTRIBUTING.md`, which targets `main`.

**Phase 9 order:**
1. SL-090 design system.
2. SL-098 and SL-095.
3. SL-091.
4. SL-092, SL-097 and SL-093.
5. SL-100 and SL-103.
6. SL-099.

Rule R10 means Phase 9 only redesigns flows that already work. If an earlier flow is missing, it goes back to its own item.

**Phase 10 order:**
1. SL-101 data migration and staged release.
2. A stable window.
3. SL-075 (branded Auth, D-06) and SL-102 (final legacy sweep).

**Recommendations:**
- **SL-101 dependencies:** give it real `dependsOn` entries. Today it has none, but it needs every slice's contract migration, SL-080 and SL-004.
- **Production guards:** rehearse the production guards on a staging copy made from production. SL-020's `20261122000000` stops unless every record maps to a season and polls are empty.
- **Auth changes:** test SL-075 and SL-103 only against non-production Auth, and switch the OAuth client and its callbacks in the right order.

## Cross-cutting risks
1. **D-08 is the decision that affects most items:** a late change means rework in SL-022, SL-050, SL-054 and SL-063.
2. **The SL-032 port is the critical path** (54 handlers). Porting routes that trust a client-supplied `user_id` carries those flaws over unless SL-025 lands first, as planned.
3. **Database rows store full media URLs:** each SL-073 rewrite needs count guards and a per-bucket rollback.
4. **Every staging run leaves `audit_log` rows:** they are permanent by design, so expect growth on staging.
