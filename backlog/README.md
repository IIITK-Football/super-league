# Backlog

The ordered product backlog, one file per item, so tooling can check it. Prose is for people; the front matter is for `pnpm work`.

| Path | What it holds |
|---|---|
| `items/SL-xxx.md` | One item. Front matter: `id`, `title`, `phase`, `status`, `legacy`, `dependsOn`, `decisions`, `groups` (test groups that must pass), `plan`, `checks` (acceptance checks). The body is the issue, required outcome and completion checks. |
| `phases.md`, `overview.md` | The phase list and the repository diagnosis and dependency order. |
| `rules.json` | The cross-cutting acceptance rules (R1 to R10) and how each is enforced. |
| `superseded.json` | Items folded into others when the backlog was restructured (id, the items that now own the work, date, note). A superseded item has no file; `pnpm work status` names its successors. Finished or approved work is never superseded. |
| `decisions.json` | Open implementation choices (D-xx). An item cannot become ready while a decision it depends on is open. |
| `approvals/`, `attestations/`, `evidence/` | The owner's plan approvals, the owner's attestations of manual checks, and machine-captured test evidence. Written by `pnpm work` commands. |

Status flows `not-started` → `ready` → `in-progress` → `done` (or `blocked`). `legacy-done` marks items closed before the workflow existed. Change status only with the commands below; CI rejects any other change.

```
pnpm work status [SL-xxx]          what is open / what an item still needs
pnpm work approve SL-xxx           OWNER: approve the plan (docs/plans/SL-xxx.md)
pnpm work ready SL-xxx             Definition of Ready, then ready
pnpm work start SL-xxx             ready -> in-progress
pnpm work attest SL-xxx C2 [note]  OWNER: attest a manual check
pnpm work done SL-xxx [--base <ref>]  Definition of Done: runs the item's groups and checks, records
                                   evidence, writes docs/walkthroughs/SL-xxx.md, marks it done when complete
pnpm work rerecord SL-xxx          re-record a done item's evidence on a fully clean tree (re-runs its groups;
                                   status, checks and attestations are unchanged)
pnpm work check [--base <ref>]     what CI runs
```

A phase is complete when every item in it is `done` or `legacy-done`. No item in a later phase can become ready before then. See `docs/process/workflow.md` for the full set of gates.

For assignment and integration order, use the [release phases](phases.md). Before starting a user-facing slice, review the entry point, key screen sketch and numbered scenarios with the owner. Contributors can prepare PRs in parallel and attach local evidence. Maintainers handle item status, staging evidence, and release approvals according to the existing workflow.
