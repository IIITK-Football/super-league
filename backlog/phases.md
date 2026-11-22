# Release order

[Open item records](items/) define the assigned work and its acceptance scenarios. Assign an owner in the contributor issue or handoff, review the flow and key screens, and then let contributors build and test approved slices on separate branches from `develop`. A later-phase PR can be prepared in parallel. Merge it only after the shared Worker baseline and its release prerequisites pass, following the existing phase gate for maintainer status. Each release records the next staging walkthrough, outstanding checks and owner actions, and actual staging and production dates separately in [the release record](../docs/release.md).

| Phase | Release or milestone | Items |
| --- | --- | --- |
| 0–2 | Completed foundation, domain slices and API compatibility baseline | Historical records and evidence remain under the original phases. |
| 3 | Worker baseline for active flows | [SL-030](items/SL-030.md), [SL-031](items/SL-031.md), [SL-032](items/SL-032.md). The archive at `/wc` and HLS playback have separate dispositions. |
| 4 | Season setup and published rules | [SL-040](items/SL-040.md), [SL-044](items/SL-044.md). Review division settings, sections, the public season picker and the rules editor before building. |
| 5 | Individual player registration | [SL-045](items/SL-045.md). Review applicant, identity resolution, and ordered approval screens. |
| 6 | Online match operations | [SL-050](items/SL-050.md), [SL-054](items/SL-054.md). Review phone scorer and bracket setup, including after-result corrections. |
| 7 | Matchday extensions | [SL-053](items/SL-053.md), [SL-108](items/SL-108.md). Lineups, offline sync and account-bound scorer invitations. |
| 8 | Fantasy, player cards and media readiness; home and match sharing follow as media becomes ready | [SL-043](items/SL-043.md) and [SL-104](items/SL-104.md) can advance independently of [SL-070](items/SL-070.md), [SL-071](items/SL-071.md), [SL-072](items/SL-072.md), [SL-105](items/SL-105.md) and [SL-106](items/SL-106.md). [SL-060](items/SL-060.md) and [SL-061](items/SL-061.md) use the verified paths. |
| 9 | Frontend redesign | [SL-090](items/SL-090.md) foundations first, then [SL-091](items/SL-091.md), [SL-092](items/SL-092.md), [SL-093](items/SL-093.md), [SL-095](items/SL-095.md), [SL-097](items/SL-097.md), [SL-098](items/SL-098.md) and [SL-099](items/SL-099.md). Begin with a public division and phone scorer example. |
| 10 | Platform close-out | [SL-029](items/SL-029.md), [SL-034](items/SL-034.md), [SL-073](items/SL-073.md), [SL-074](items/SL-074.md), [SL-081](items/SL-081.md), [SL-082](items/SL-082.md), [SL-101](items/SL-101.md). Apply the release checklist to earlier releases too. |
| 10 | Registration and account extensions | [SL-046](items/SL-046.md), [SL-047](items/SL-047.md), [SL-075](items/SL-075.md), [SL-103](items/SL-103.md), [SL-107](items/SL-107.md). Honor item prerequisites within this phase. |
| 10 | Partner feed and final sweep | [SL-063](items/SL-063.md), [SL-102](items/SL-102.md). The sweep follows cutover evidence and retention windows. |

The validator accepts phases 0–10. The separately shippable milestones in phases 8 and 10 use explicit item dependencies within the existing phase. A phase closes when its items are done. Work out of sequence can be prepared in separate PRs, but the status commands and protected release checks still govern integration.

An item's approved screens and numbered scenarios are the walkthrough contract. Use the real local and staging app under R10 for people-facing changes. Record the served commit, actor, action, and observed result. A production release that changes media uses a verified production serving path, with owner approval for any hosted cutover.

See [the contributor issue edits](../docs/plans/contributor-issues.md) for the three existing help-wanted assignments.
