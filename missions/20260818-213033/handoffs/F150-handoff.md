# Handoff: F150 — subtasks in the task detail view

## Status
COMPLETE

## Assertions covered
AS-263: PASS — a child task's `getTaskDetail` result carries its live parent's `id`/`title`/`projectKey`/`number` (`lib/actions/tasks.ts`), and `TaskDetailSheet` renders a "Subtask of PM-NNN" breadcrumb button (icon `CornerUpLeft` + text) whenever `task.parent` is set. Clicking it calls the new `onOpenTask` callback, which board.tsx/task-list-table.tsx wire to the same `useTaskDetailSheet().openTask` that already opens a task from a card/row click — so clicking it re-opens the Sheet on the parent. A top-level task's `parent`/`parentTaskId` are both `null`, so no breadcrumb renders for it. Covered by `tests/integration/subtask-ui-detail.test.ts`'s `test_AS_263_a_childs_task_detail_carries_its_parents_id_title_and_key` and `test_AS_263_negative_a_top_level_tasks_detail_carries_no_parent` (data correctness, against the real linked Supabase project), and by the live-interaction Playwright test `tests/e2e/subtask-ui.spec.ts`'s `AS-263: a child task shows a link back to its parent, and clicking it opens the parent` (opens the real Sheet in a real browser, clicks the real breadcrumb button, asserts the Sheet now shows the parent's title).
AS-264: PASS — `getTaskDetail` now fetches a parent task's live children (id/title/status/assigneeId) in the SAME query round trip as comments/attachments (one extra `Promise.all` entry, not a per-child fetch), and the new `SubtaskList` component (`components/task/subtask-list.tsx`) renders each child's title, a status chip (text label + colour dot, never colour alone), an assignee avatar, and a "N of M done" completion count computed by the pure `countSubtaskProgress` (`lib/tasks/subtask-progress.ts`). Covered by `tests/unit/subtask-list.test.ts` (11 tests: status/count rendering, zero-children empty state, all-done count, assignee avatar rendering, the pure `countSubtaskProgress` function directly, and the pure `appendSubtask` optimistic-append reducer including idempotency), `tests/integration/subtask-ui-detail.test.ts` (children/count data against the real database, a newly-added subtask appearing on the very next `getTaskDetail` call, a promoted subtask disappearing from its former parent's children), and the Playwright test's `AS-264: a parent's Subtasks section lists each child with its status and a completion count, updating immediately after adding one` (opens the real Sheet, reads the real "1 of 2 done" text, adds a real subtask through the real inline quick-add form, and asserts the count becomes "1 of 3 done" with no reload).
AS-275: PASS — verified explicitly, not assumed: `getProjectBoardTasks` (`lib/queries/tasks.ts`) was extended ONLY by adding a second, whole-project aggregate query for `subtaskCount`; its own row-selecting query/filter was not touched, so a child task (subtask) continues to be selected and returned as an ordinary row exactly like before this feature. Covered by `tests/integration/subtask-ui-detail.test.ts`'s `test_AS_275_a_child_task_still_appears_as_its_own_ordinary_row_on_the_board_query` (seeds a real parent+child pair, calls the real function, asserts both come back as separate rows with distinct ids) and `test_AS_275_a_task_with_multiple_children_reports_the_correct_count` (3 children + 1 parent = 4 separate rows, not 1), plus the Playwright test's `AS-275: child tasks render as their own ordinary board cards, and the parent card shows an icon+text subtask indicator` (all three seeded tasks visible as separate cards in a real browser; clicking the child card opens the CHILD's own detail, proving it's a real independent card, not decorative text under the parent).

## Files changed
lib/tasks/subtask-progress.ts (new)
lib/tasks/append-subtask.ts (new)
components/task/subtask-list.tsx (new)
components/task/task-detail-sheet.tsx
components/task/task-card.tsx
components/board/board.tsx
components/task/task-list-table.tsx
lib/actions/tasks.ts
lib/queries/tasks.ts
tests/unit/subtask-list.test.ts (new)
tests/integration/subtask-ui-detail.test.ts (new)
tests/e2e/subtask-ui.spec.ts (new)

## Commands run
`npx vitest run tests/unit/subtask-list.test.ts --testTimeout=30000` (0) — 11/11 passed
`npx vitest run tests/integration/subtask-ui-detail.test.ts --testTimeout=30000` (0) — 7/7 passed against the real linked Supabase project
`npx vitest run --testTimeout=30000` (0) — full suite, 674/674 passed across 114 files (up from F149's 656/112 — this feature's own 18 new tests, no regressions)
`npx playwright test tests/e2e/subtask-ui.spec.ts` (0) — 3/3 passed against a real Next.js dev server + real browser + real Supabase auth
`npx playwright test` (0) — full e2e suite, 10/10 passed (board-reorder ×1, subtask-ui ×3, theme-toggle ×6) — no regressions
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 1 pre-existing warning: `lib/queries/search.ts:232` `_titleMatches` unused — not from this feature, called out by the mission brief as known/not mine)

Per the mission brief, the default 5s vitest timeout is unreliable against
the real remote Supabase project, so every vitest run above used
`--testTimeout=30000`. No unrelated flakiness was observed at that
timeout.

No dev server was started manually for this feature; before running
Playwright, `ps aux | grep "next dev"` confirmed no stray dev server was
already running, so nothing needed killing. Playwright's own
`webServer` config (`playwright.config.ts`) started and stopped a real
`next dev` on port 3100 for the test run itself, per this repo's existing
convention; no server process was left running afterward (re-checked).

## Decisions made

- **Where the parent/children data is fetched: inside `getTaskDetail`,
  not a new query/action.** The worker brief was explicit ("Fetch it with
  the existing task detail query rather than a per-child round trip").
  `getTaskDetail`'s task select gained `project_id`/`parent_task_id`; two
  more entries were added to its existing `Promise.all` (a children query,
  always run — harmless zero rows for a task that's itself a child, since
  F148 forbids two-level nesting — and a parent query, run only when
  `parent_task_id` is set). Both a parent's and its children's task-key
  badges reuse the CURRENT task's own already-fetched `projectRow.key`
  rather than a second per-row project join, since F148's invariant
  guarantees a subtask always shares its parent's project.
- **Board card subtask-count: one extra whole-project aggregate query in
  `getProjectBoardTasks`, not a per-row query, and NOT a change to the
  existing row-select/filter.** This was the specific trap the brief
  warned about ("the natural instinct when adding a subtask section is to
  filter children out of the board, which would break AS-275"). The fix
  deliberately keeps the original `.from("tasks").select(...)` completely
  untouched and adds a second query (`select parent_task_id where
  project_id = X and deleted_at is null and parent_task_id is not null`)
  that is reduced into a `Map<parentId, count>` in JS and merged onto the
  existing per-task objects. Verified with an integration test that
  actually seeds a parent+child pair and calls the real function (not a
  source-text check) — see AS-275 above.
- **Board card indicator: icon (`ListTree`) + text ("N subtask(s)"), same
  pairing as the existing overdue indicator**, per the brief's explicit
  instruction that this is re-checked by AS-525 later in the mission.
  `subtaskCount` is `undefined` (not `0`) when a task has no children,
  matching every other optional indicator field's (`totalMinutes`,
  `updatedAt`) existing "safe default" convention in `TaskCardTask`.
- **Quick-add pattern: reused CommentList's exact shape (Input + submit
  Button, native form, disabled while pending, cleared on success,
  toast.error on failure), not a new component.** Per the clarification's
  explicit Notes-for-clarification answer ("reuse the quick-add
  interaction pattern from F248 so adding subtasks feels the same as
  adding tasks") and the "simpler option, no new dependency, no second
  source of truth" ambiguity-resolution rule — F248 itself doesn't exist
  yet in this mission, so "reuse the pattern" was read as "match the
  existing sibling add-item forms already living in this exact Sheet"
  (CommentList/AttachmentList), which is the closest concrete precedent
  available today.
- **Access control: no new `lib/auth/permissions.ts` dependency
  introduced.** The clarified spec's default access-control answer names
  that module as the single source of truth for hiding/disabling controls
  a user lacks rights for — it does not exist yet in this codebase (it is
  its own not-yet-built feature, AS-230, listed only in tech-decisions.md's
  file layout). Rather than build a new cross-cutting permissions module
  out of this feature's scope, the add-subtask form follows the SAME
  convention every sibling add-item form in this Sheet already uses today
  (CommentList's addComment, AttachmentList's uploadAttachment): available
  to any active workspace member, re-verified server-side by `createTask`
  itself (unchanged from F149 — membership + parent/child invariants are
  already independently re-checked there). This is the "simpler option
  that adds no new dependency" the ambiguity-resolution rule calls for.
- **`children` renamed to `childTasks` as SubtaskList's prop name.**
  `children={...}` as a literal JSX attribute triggers
  `react/no-children-prop` (React reserves `children` for its own nesting
  convention) — caught by `npx eslint .` during this feature, fixed by
  renaming the prop (the TYPE field on `TaskDetailSheetTask` stays named
  `children`, since that's plain data, not a JSX prop).
- **Child rows in the Subtasks section are clickable (open the child in
  the Sheet) when `onOpenTask` is provided.** Not explicitly required by
  AS-263/AS-264's wording, but it closes the loop those two assertions
  set up (parent shows children -> clicking one opens it -> the opened
  child shows a link back), reuses the exact same `onOpenTask` callback
  the breadcrumb already needed, and required no new dependency — judged
  in-scope under the "simpler option" rule rather than a scope expansion,
  since implementing the breadcrumb without also making the list
  navigable would have been the more surprising (asymmetric) choice.
- **"Done" still means the fixed `status === "done"` check** (both in
  `lib/tasks/subtask-progress.ts`'s `countSubtaskProgress` and nowhere
  else — it's the only place this feature adds a completion count).
  Per the brief: custom statuses arrive in M16 (F218-F222), and F222 is
  expected to sweep this exact check. Isolating it in one pure,
  single-purpose function (rather than inlining `=== "done"` in the
  component) is specifically so that future sweep only touches one file.

## Out-of-scope work needed

- **F222 (custom statuses, M16) must sweep `lib/tasks/subtask-progress.ts`'s
  `countSubtaskProgress`** — it currently hard-codes `status === "done"`
  as "complete". Once a workspace can configure its own status set with a
  a designated "done" status/statuses, this function's single `.filter()`
  line needs to look that up instead of comparing to a string literal.
  Everything that calls it (`SubtaskList`) reads the returned
  `{done, total}` shape, not the comparison itself, so no other file
  needs to change.
- **List view and dashboard table show no subtask indicator.**
  `getProjectListTasks`/`getWorkspaceListTasks` (`lib/queries/tasks.ts`)
  were NOT extended with the same `subtaskCount` aggregate this feature
  added to `getProjectBoardTasks` — the feature spec's Draft scope named
  only "Board card shows a small subtask indicator," and `TaskListTable`
  renders a plain table row with no room for an icon+text indicator
  without its own design decision. `TaskCardTask.subtaskCount` is already
  a shared optional field on the type both queries' results flow through,
  so a future feature adding this to the List view only needs to (a) add
  the same aggregate query to those two functions and (b) decide where in
  `TaskListTable`'s row layout the indicator goes — no type or query
  restructuring required.
- **No "Promote to top level" button was added to the UI**, even though
  `promoteSubtask` (F149) is fully implemented and this feature's own
  Playwright test calls it indirectly via `getTaskDetail` re-fetch
  assertions. The feature spec's Draft scope didn't ask for a promote
  control, only the subtask list + breadcrumb + board indicator — a
  future feature can add a "Promote" action to the Sheet's footer
  (alongside the existing Delete button) calling the already-exported
  `promoteSubtask(taskId)` directly.
- **The child row's status chip is display-only** — there is no inline
  status editor on a subtask row (matching the parent Sheet's own Status
  Select, which is ALSO read-only today per F039's pre-existing
  limitation: "No Server Action currently persists task status changes").
  Once a `changeTaskStatus` action exists (noted as a future feature in
  `task-detail-sheet.tsx`'s own long-standing comment, unrelated to this
  feature), a subtask row's status chip is the natural place to wire the
  same control.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Followed CommentList/AttachmentList's existing
"available to any active member, server re-verified" access-control
convention instead of introducing `lib/auth/permissions.ts` — see
"Decisions made" above for the full rationale. Genuinely open (the
clarified spec's default answer names a module that doesn't exist yet in
this codebase), resolved via the ambiguity-resolution rule (simpler
option, no new dependency, no second source of truth).

AUTONOMOUS_DECISION: Made Subtasks-section child rows clickable (open the
child in the Sheet) via the same `onOpenTask` callback the parent
breadcrumb needed, even though this wasn't explicitly asked for by
AS-263/AS-264's wording — see "Decisions made" above.

## Notes for the next worker

- `TaskDetailSheet` gained a new optional prop, `onOpenTask?: (taskId:
  string) => void`, used both by the parent breadcrumb and by
  `SubtaskList`'s child rows to navigate within the same Sheet instance.
  Both real callers (`components/board/board.tsx`,
  `components/task/task-list-table.tsx`) wire it to their own
  `useTaskDetailSheet().openTask` — the SAME function that already opens
  a task from a card/row click, so opening a parent/child from inside the
  Sheet reuses the exact same fetch-on-open plumbing
  (`components/task/use-task-detail-sheet.ts`) rather than adding a
  second one. A caller that hasn't been updated (tests/fixtures) simply
  renders the breadcrumb/child-row as non-interactive rather than
  crashing (`disabled={!onOpenTask}` on the breadcrumb button;
  `role`/`tabIndex`/`onClick` all conditionally `undefined` on child
  rows), matching this file's existing optional-prop conventions.
- `TaskDetailSheetTask.children` (the DATA field) and `SubtaskList`'s
  `childTasks` (the PROP name) refer to the same array — the prop is
  named differently on purpose (see Decisions made: `react/no-children-prop`).
  Don't "fix" this into a naming mismatch bug; it's intentional.
- `getTaskDetail`'s doc comment at the top of `lib/actions/tasks.ts` was
  NOT rewritten in full — only its `.select()` string comment and the
  return-object mapping were annotated inline with F150 notes. The
  function's shape is otherwise unchanged (same auth/membership checks,
  same `Promise.all` pattern, just two more entries in it).
- `tests/unit/subtask-list.test.ts` and `tests/integration/subtask-ui-detail.test.ts`
  cover DIFFERENT things and are both needed: the unit test proves the
  component's rendering/counting/appending logic in isolation (fast, no
  network), while the integration test proves the REAL `getTaskDetail`/
  `getProjectBoardTasks` functions return the right shape against the
  real linked Supabase project (RLS, real triggers, real F148 invariants
  all actually exercised). Neither one alone would have caught, e.g., a
  bug in the new `Promise.all` wiring inside `getTaskDetail` itself.
- `tests/e2e/subtask-ui.spec.ts` is the ONLY place in this feature's test
  suite that actually renders `TaskDetailSheet`'s open (populated) state
  in a browser. `components/ui/sheet.tsx` portals its content
  (`SheetPortal`/Base UI's `Dialog.Portal`), and React portals are not
  rendered by `renderToStaticMarkup` — this is why
  `tests/unit/task-key-display-render.test.ts`'s own doc comment
  explicitly calls out that TaskDetailSheet's interactive/open-state
  content isn't unit-render-tested in this repo, and why this feature's
  breadcrumb and the Sheet-level "N of M done" text needed a real
  Playwright test rather than a `renderToStaticMarkup` unit test (the
  standalone `SubtaskList` component itself, rendered directly rather
  than through the portaled Sheet, IS unit-render-tested — see
  `tests/unit/subtask-list.test.ts`).
- MCP usage: none required at runtime — no schema/migration changes in
  this feature (F149 already added every column/RPC this feature reads:
  `parent_task_id`, `deleted_via_task_id`, `cascade_delete_task`). No
  Supabase MCP introspection beyond what the integration/e2e tests'
  actual calls against the real linked project already confirm was
  needed.
- What this feature's tests do NOT cover, stated plainly per the mission
  brief's instruction not to overstate coverage: keyboard-only operation
  of the breadcrumb/child-row buttons and screen-reader announcement
  quality were not separately tested (both are native `<button>`
  elements with `aria-label`s, consistent with this Sheet's existing
  click-to-copy button precedent, but no dedicated accessibility test was
  written for this feature specifically). The repo still has no
  jsdom/@testing-library environment (arrives in F277); nothing in this
  feature's test suite is a source-text/string-presence grep standing in
  for a real test.
