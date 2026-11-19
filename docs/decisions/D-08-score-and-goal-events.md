# D-08: Authoritative score and goal events

**Status:** Resolved by the owner on 2026-11-19. Applies to SL-022 (canonical match events and statistics) and the later scorer workspace (SL-050). Design detail is in `D-08-score-and-goal-events-proposal.md` (option D). Where the two differ, this record wins.

## Decision

1. **Events are the source of truth (option D).**
   - Match events (goals, own goals and, later, cards) are what happened.
   - The visible score is a cache maintained by the database from the non-voided events, in the same transaction.
   - Clients can never set an absolute score for a played match; a guard refuses any other score write.
2. **Score-only edits.**
   - **+1 without an identified scorer** adds an **unattributed goal event**. It counts toward the score but toward no player's statistics.
   - **−1** removes an unattributed goal for that side if there is one; otherwise the scorer must choose which event to correct. Nothing is removed silently.
3. **Walkovers and forfeits are explicit awarded results.**
   - An awarded result kind (walkover, forfeit) needs a **required reason** and a **stored awarded score**, and it has no goal events.
   - **3–0 is only the current default award,** not a hard-coded rule for every division: the dictator can enter another score, and the default may become a division or season setting.
4. **Migration.**
   - **Surplus:** a score surplus that remains after converting goal rows and the JSON-only goals becomes clearly **tagged unattributed events**, listed in a report.
   - **Blockers:** the migration **aborts without changing anything** on orphan goals (a goal for a team not in the match), on **more goal rows than the recorded score**, or on any other unresolved blocker.
   - **Rehearsal:** it is rehearsed on a **local production-shaped copy** before any hosted rollout.
5. **Corrections never regrade silently.** A correction to a completed match marks it **"needs regrade"** for a dictator to regrade.
6. **Cards stay out of scoring and fantasy** until their rules are defined. **Penalty shootouts** stay as two separate totals, never goal events.

## Answers to the proposal's questions
| Proposal question | Answer |
|---|---|
| Q1 adopt option D | Yes |
| Q2 explicit awarded results | Yes, with a required reason and a stored score; 3–0 is the current default, not hard-coded |
| Q3 −1 with no unattributed goal | The scorer chooses the event to correct |
| Q4 migration surplus | Tagged unattributed events plus a report; abort on orphan goals, more goal rows than the score, or other blockers; rehearse on a local production-shaped copy |
| Q5 regrade after a correction | Flag "needs regrade" for a dictator; no automatic regrade |
| Q6 cards in scoring | No, until rules exist |
| Q7 penalty shootouts | Separate totals |
