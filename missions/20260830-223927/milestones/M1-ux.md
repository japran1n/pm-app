# M1 — UX validation report (Optimistic UI hardening)

Mission: 20260830-223927 · Milestone: M1 · Date: 2026-08-31
Validator: UX validator subagent (Playwright, Chromium, 1400x950)

## Environment / how this was run

- App booted per `tech-decisions.md` "How to run": `npm run dev` → Next.js 16.3.1 (Turbopack),
  ready on `http://localhost:3000`. Boot succeeded.
- Real auth against the real linked Supabase project. A throwaway workspace
  (`m1ux-<ts>`), admin member, project, one task (`M1 Alpha Task`, status `todo`,
  priority `low`, due `2026-09-10`, assigned to the test user) and three
  `personal_todos` rows were seeded with the admin client; a real
  `signInWithPassword` session was injected as the `sb-<ref>-auth-token` cookie
  (same technique already used by `tests/e2e/board-reorder.spec.ts`).
- **"Before the server responds" was measured, not assumed.** All Server Action
  POSTs (`next-action` header) were intercepted by `page.route`:
  - `delay` mode — request held for **4000 ms** before being forwarded. Any UI change
    observed inside that window provably happened before the server responded.
  - `fail` mode — request `route.abort("failed")`, i.e. the mutation never reaches
    the server. This is the "server rejects" simulation for the revert/toast assertions.
- All seeded workspaces, projects, tasks, todos and auth users were deleted afterwards
  (verified: 0 remaining). The dev server was stopped. No project code was modified.
- Evidence: `missions/20260830-223927/milestones/M1-evidence/`

## Results

| ID | Verdict | Evidence | Reproduction / observation |
|---|---|---|---|
| AS-001 | PASS | `M1-evidence/AS-001-priority-optimistic.png` | List view → priority Select for the task → choose **Urgent**. Cell read "Urgent" **76 ms** after selection while the `editTask` POST was held for 4000 ms. |
| AS-002 | PASS | `M1-evidence/AS-002-priority-revert.png` | List view, action aborted → choose **Backlog**. Toast "Failed to update priority" appeared and the cell returned to its prior value ("Low"). |
| AS-003 | PASS | `M1-evidence/AS-003-duedate-optimistic.png` | List view → due-date input → type `2026-12-25`. Input showed the new date immediately with the POST held 4000 ms. |
| AS-004 | PASS | `M1-evidence/AS-004-duedate-revert.png` | List view, action aborted → type `2027-01-15`. Toast "Failed to update due date" and the input reverted to `2026-12-25`. |
| AS-005 | **FAIL** | `M1-evidence/AS-005-status-optimistic.png`, `M1-evidence/DIAG-D-second-status-immediate.png` | Only the **first** status change after the sheet is opened is optimistic. First change → badge read "In Progress" 102–133 ms after selection with the POST held 4000 ms (correct). A **second** change in the same open sheet (In Progress → In Review, POST held 4000 ms) left the badge frozen on "In progress" for the full delay and only flipped to "In review" after the server replied. See "FAIL detail" below. |
| AS-006 | PASS | `M1-evidence/AS-006-status-optimistic-then-revert-mid.png`, `M1-evidence/AS-006-status-revert.png` | Fresh sheet (status "To do"), action aborted → choose **In Review**. Toast "Failed to set status to In review"; badge stayed/returned to "To do". Sampled before/mid/after = `["To do","To do","To do"]` (the abort resolves faster than the sampler, so no wrong value is ever shown — the assertion's requirement is met). |
| AS-007 | **FAIL** | `M1-evidence/AS-007-priority-optimistic.png`, `M1-evidence/DIAG-A-first-clear-immediate.png`, `M1-evidence/DIAG-B-second-priority-immediate.png`, `M1-evidence/AS-007-clear-FAIL.png`, `M1-evidence/AS-007-clear-after-settle.png` | Same defect as AS-005. First change in a fresh sheet is optimistic — including **clear to "No priority"** (Low → No priority rendered immediately with the POST held 4000 ms). A **second** change in the same open sheet is not: No priority → Urgent stayed on "No priority" for the whole 4000 ms delay and only became "Urgent" after the server replied. Originally caught as Urgent → No priority failing to clear; the diagnostic isolates ordinal, not the clear operation, as the cause. |
| AS-008 | PASS | `M1-evidence/AS-008-priority-optimistic-then-revert-mid.png`, `M1-evidence/AS-008-priority-revert.png` | Fresh sheet (priority "Low"), action aborted → choose **High**. Sampled before/mid/after = `["Low","High","Low"]` — badge went optimistic to "High", then reverted to "Low" with toast "Failed to set priority to High". |
| AS-009 | PASS | `M1-evidence/AS-009-title-saving-indicator.png`, `M1-evidence/AS-009-title-committed.png` | Detail sheet → edit Title to "M1 Alpha Task RENAMED" → Enter, with the POST held 4000 ms. `[data-testid="title-saving-indicator"]` spinner (+ `role="status"` "Saving title…") was visible for the whole in-flight window, then toast "Title updated.". |
| AS-010 | PASS | `M1-evidence/AS-010-title-revert.png` | Fresh sheet, action aborted → set title to "SHOULD NOT PERSIST" → Enter. Toast "Failed to save title" and the input reverted to the pre-edit value. See "Observation" below for a chained-edit caveat. |
| AS-011 | PASS | `M1-evidence/AS-009-title-committed.png`, `M1-evidence/EXTRA-escape-cancels-title.png` | Pressing **Enter** in the Title input commits the rename in place — no confirmation/edit dialog is opened at any point; toast "Title updated." and the input holds the new value. Additionally verified the cancel path the milestone brief mentions: typing "ESCAPE ME" then **Escape** restored the pre-edit title and fired **0** Server Action POSTs, with the sheet remaining open. |
| AS-012 | PASS | `M1-evidence/AS-012-todo-checked-optimistic.png` | My Tasks → check "M1 Todo Open". Checkbox rendered checked with line-through **42 ms** after the click, POST held 4000 ms. |
| AS-013 | PASS | `M1-evidence/AS-013-todo-revert.png` | My Tasks, action aborted → check "M1 Todo Fail". Toast "Failed to update task" and the checkbox reverted to unchecked. |
| AS-014 | PASS | `M1-evidence/AS-014-todo-unchecked-optimistic.png` | My Tasks → uncheck the already-done "M1 Todo Done". Checkbox rendered unchecked (line-through removed) **55–64 ms** after the click, POST held 4000 ms. |

**Score: 12 PASS / 2 FAIL / 0 INCONCLUSIVE.**

## FAIL detail — AS-005 and AS-007 (one shared defect)

**Assertion:** "Changing a task's status/priority in the task detail sheet updates the
badge immediately."

**Actual:** Immediate only for the first status change and the first priority change
after the sheet is opened. Every later change to the same field in the same open sheet
shows the *previously confirmed* value until the Server Action resolves — the exact
latency-visible behaviour the assertion exists to prevent. Users edit a field more than
once per sheet routinely, so this is reachable in ordinary use.

Isolating run (each step with the Server Action held 4000 ms, one freshly opened sheet
per block):

```
A  1st priority change (Low -> No priority)     immediate: "No priority"   <- optimistic OK
B  2nd priority change (No priority -> Urgent)  immediate: "No priority"   <- STALE
                                                after settle: "Urgent"
C  1st status change (To do -> In progress)     immediate: "In progress"   <- optimistic OK
D  2nd status change (In progress -> In review) immediate: "In progress"   <- STALE
                                                after settle: "In review"
```

**Repro:** open any task's detail sheet → change Status twice in a row (or Priority
twice in a row), throttling/delaying the Server Action. The second change's badge does
not move until the server replies.

## Suggested fixes (not applied — validator does not modify code)

`components/task/task-detail-sheet.tsx`: the `value` bindings read the F023
"confirmed" mirror ahead of the optimistic value:

- Status: `value={confirmedStatus ?? optimisticStatus ?? task.status}`
- Priority: `value={confirmedPriority !== undefined ? confirmedPriority : optimisticPriority !== undefined ? optimisticPriority : task.priority}`

`confirmedStatus`/`confirmedPriority` are set by the *previous* successful save and are
only updated again once the *next* save resolves, so they mask `optimisticStatus`/
`optimisticPriority` for the whole duration of every subsequent in-flight mutation. The
optimistic value must win while a transition is in flight — e.g. clear the confirmed
mirror at the start of `handleStatusChange`/`handlePriorityChange` (inside the
transition, before the `await`), or reorder the precedence so the optimistic override
takes priority whenever `isSavingField` is true.

## Observations (not assertion failures)

- **AS-010, chained edits.** `handleTitleBlur` captures `previousTitle = task.title`
  (the server prop), not the currently displayed title. After a *successful* rename
  whose result has not yet propagated back into the `task` prop, a subsequent failed
  save reverts the input to the older, pre-first-rename title rather than to the value
  the user actually saw before the failed edit. Observed once during testing
  (displayed "M1 Alpha Task RENAMED" → failed save → reverted to "M1 Alpha Task").
  AS-010 is scored on the ordinary single-edit case, which passes.
- The first-run onboarding tour dialog ("Welcome to pm-app") overlays the list view for
  a new user and must be skipped before rows are clickable; not an assertion, noted for
  future automation.
- Two harness-caused crashes were observed while removing sonner toast nodes directly
  from the DOM (`insertBefore` NotFoundError in `components/ui/sonner.tsx`). That was
  the test harness mutating React-owned DOM, **not** an application defect; the harness
  was changed to wait for auto-dismiss and the crashes disappeared.

## Not exercised in this milestone

AS-015 … AS-024 (realtime for My Tasks, Calendar and the command palette) are outside
M1's assigned range and were not run.
