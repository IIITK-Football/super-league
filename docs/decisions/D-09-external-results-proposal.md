# D-09 proposal: external fixture and score imports

Status: **proposal, open**. The owner resolves D-09 before SL-063 starts (Phase 6). Drafted 2026-11-18. This proposal picks no vendor.

## 1. Current state
- **No integration exists.** There is no provider code, external identifier, import table or job.
- **Be.tech was an example,** not a committed provider (SL-063).
- **Matches today** have a schedule (`date`, `venue`, `status`) and score caches with no source column. `audit_matches` and `audit_goals` record changes.
- **Target model (D-08 proposal):**
  - the score derives from `match_events` (client ids, versions, voiding);
  - the API never accepts an absolute score for a played match;
  - a goal with no player is an unattributed goal.
- **Scorer workflow (SL-050):** idempotent queued actions, explicit conflict resolution, and never silently overwriting newer data.

## 2. Options
| | A: auto-apply | B: review everything | **C: auto-apply safe schedule changes, queue the rest** | D: no integration |
|---|---|---|---|---|
| Manual edit safety | poor | good | good | n/a |
| Scorer effort | none | high | low | manual entry |
| Fits D-08 (events only) | has to fake events | yes | yes | yes |
| Needs a UI (R10) | no | yes | yes (small) | no |

## 3. Recommendation: C, once the owner names a provider
**Adapter contract.** Each provider's code lives in `adapters/<provider>/`, reads and normalises only, and never writes:
```ts
interface ResultsAdapter {
  id: string;
  fetchFixtures(window: { from: Date; to: Date }): Promise<ExtFixture[]>;
  fetchResults(since: Date): Promise<ExtResult[]>;
}
// ExtFixture: externalMatchId, homeRef, awayRef, kickoff, venue?, status, revision?
// ExtResult:  externalMatchId, status, homeGoals, awayGoals,
//             events?: { externalEventId?, kind: 'goal'|'own_goal', teamRef, playerRef?, minute? }[]
```
A shared importer does the rest:
- maps references through `external_links (provider, entity_kind, external_id) → internal id`, which a dictator confirms once;
- writes proposals or changes, and logs every run.

Replacing a provider means a new adapter and new links, with no change to the core models.

**Precedence:**
1. A manual edit by a scorer or dictator always wins.
2. Any event a person created or edited is **confirmed**. Imports never update or void a confirmed event, and never void any event.
3. Imported goals become `match_events` only after a person accepts them. The player is set only when the player link is confirmed; otherwise they go in as unattributed goals. Each records `source = 'import:<provider>'` and a source reference.
4. A provider score higher than the derived score becomes proposed goal events. A lower score, or a match with manual events, raises a **conflict** for a person to resolve.
5. Kickoff and venue apply automatically only if no person changed them since the last import; otherwise they are queued.
6. A completed match is closed to imports; changes go only to the queue.

**Idempotency:**
- `external_links` is unique on (provider, kind, external_id).
- Event ids are `uuidv5(provider|externalMatchId|externalEventId)`, or a hash of the event's fields when the provider has no event ids.
- Payload hashes skip unchanged records.
- `import_runs` records each run.

**Review queue:**
- `import_proposals` (fixture create/update, event add, score conflict; pending, accepted, rejected or superseded; who decided and when).
- The assigned scorer or a dictator resolves a match's events and conflicts; a dictator creates fixtures.
- A minimal list in the scorer workspace and the dictator dashboard (R10).
- Accepting goes through the normal event API, so audit and "needs regrade" apply.

**Operations:**
- A Worker cron about every 5 minutes in match windows, hourly otherwise.
- The provider key stays server-side.
- Retries with backoff, pausing after repeated failures.
- The provider is named next to imported data.

**Deferral:** build nothing until a provider and its terms, cost and coverage are confirmed.

## 4. Questions for the owner
1. Is any provider approved now? **Default: none; defer SL-063.**
2. Do manual edits always win, and do imports never overwrite or void a confirmed event? **Default: yes.**
3. Must a person confirm imported goals before they count? **Default: yes.**
4. May schedule changes apply automatically while no person has edited those fields? **Default: yes.**
5. Who resolves the queue? **Default: the assigned scorer for events, a dictator for new fixtures.**
6. Import only schedule and score, leaving cards and assists to people? **Default: yes.**
7. Cadence? **Default: every 5 minutes in match windows, hourly otherwise.**
8. If no provider is named by Phase 6, close SL-063 as deferred with this contract on record? **Default: yes.**
