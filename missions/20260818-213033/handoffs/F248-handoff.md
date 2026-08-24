# Handoff: F248 — quick-add-board

## Status
COMPLETE

## Assertions covered
AS-479: PASS — `components/board/quick-add.tsx` renders a collapsed "Add task" trigger per column that expands to a single text input; proven both by DOM tests (`tests/unit/f248-quick-add.test.tsx::test_AS_479_column_has_quick_add_that_expands_to_single_input`) and against the real column-resolution logic against a live Supabase project (`tests/integration/f248-quick-add-custom-column.test.ts` — creates into a genuinely custom, non-fixed-four column name, and rejects a nonexistent one).
AS-480: PASS — `tests/unit/f248-quick-add.test.tsx::test_AS_480_input_clears_and_keeps_focus_after_create` — after a successful createTask call the input clears and keeps DOM focus (never collapses), so several tasks can be typed in a row.
AS-482: PASS — `tests/unit/f248-quick-add.test.tsx::test_AS_482_empty_submit_does_not_call_createTask` and `test_AS_482_whitespace_only_submit_does_not_call_createTask` — createTask is never called and no error surfaces for an empty or whitespace-only submit (trimmed-whitespace-only counts as empty, per this feature's resolved Notes-for-clarification answer).
AS-483: PASS — `tests/unit/f248-quick-add.test.tsx::test_AS_483_escape_collapses_input_without_calling_createTask` — Escape collapses the control back to the plain trigger, createTask never called.

## Files changed
components/board/quick-add.tsx (new)
components/board/board-column.tsx
components/board/swimlane.tsx
components/board/board.tsx
lib/actions/tasks.ts
lib/validation/tasks.ts
tests/unit/f248-quick-add.test.tsx (new)
tests/unit/f248-board-column-quick-add-permission.test.tsx (new)
tests/integration/f248-quick-add-custom-column.test.ts (new)

## Commands run
`npx tsc --noEmit` (0, no output)
`npx eslint .` (0 errors, 6 warnings — matches the stated baseline exactly, all pre-existing/unrelated)
`npx next build` (0 — "Compiled successfully", full route manifest generated, dev server on :3000 left untouched)
`npx vitest run tests/unit` (139 files / 1070 tests passed — up from the stated 137/1060 baseline by exactly the 2 new files / 10 new tests this feature adds; one unrelated pre-existing unhandled-rejection warning from `user-avatar.test.tsx`'s `comment-list.tsx` mount, `cookies() outside request scope` — not touched by this feature, not one of this feature's files)
`npx vitest run tests/unit/f248-quick-add.test.tsx` (0, 6/6 passed)
`npx vitest run tests/unit/f248-board-column-quick-add-permission.test.tsx` (0, 4/4 passed)
`npx vitest run tests/integration/f248-quick-add-custom-column.test.ts` (0, 3/3 passed, against the real linked Supabase project)
`npx vitest run tests/integration/create-task.test.ts tests/integration/subtask-actions.test.ts tests/integration/extension-create-task.test.ts` (0, 22/22 passed — regression proof that widening createTask's `status` param/schema didn't break the fixed-four-status create path, the subtask create path, or the browser-extension create path)

## Decisions made
- **Reused `createTask`/`createTaskForUser` directly** (lib/actions/tasks.ts) — QuickAdd calls it exactly as NewTaskDialog/subtask-list already do, so permission re-checks (canWrite, F322 project-visibility), position math (calculatePosition), and the `status`→`status_id` trigger all come for free with zero duplicated logic.
- **Widened `createTaskSchema.status`** from the original fixed four-value enum to any non-empty string (max 100 chars), matching `moveTaskStatusSchema`/`moveAndReorderTaskSchema`'s already-relaxed shape. This was necessary, not optional: F221 made board columns per-project (`project_statuses`), but `createTask` had never been updated to accept a custom column name — quick-adding into a renamed/added column was structurally impossible before this change. Added the same `project_statuses` existence check `moveTaskStatus` already performs, inside `createTaskForUser`, before the insert — a stale/forged/deleted column name now gets a specific "That column no longer exists" error instead of either a DB constraint error (there is none any more, F221 dropped `tasks_status_check`) or a silently-null `status_id`.
- Widened `createTask`/`createTaskForUser`'s TypeScript `status` param from the literal union to `string` — safe for every existing caller (the union is a subtype of `string`, so every literal call site still type-checks unchanged; confirmed via `npx tsc --noEmit` and the full existing create-task/subtask/extension integration suites, all green).
- **AUTONOMOUS_DECISION**: Trimmed-whitespace-only input counts as empty (per the feature spec's own Notes-for-clarification, already resolved to this answer before I started).
- **AUTONOMOUS_DECISION**: Access control is "hidden entirely" (BoardColumn's `canCreateTask` prop, defaulting to `false` and gated on the caller's real `canWrite`-derived permission, the same value `canDrag` already uses) rather than "shown disabled with a tooltip." The feature spec's own Draft scope explicitly says "Hidden entirely for users without create rights," which is more specific than the general Clarified-implementation Auth answer's "hidden or disabled" — took the more specific, spec-stated option. The server (`createTaskForUser`) still independently rejects the call regardless.
- **AUTONOMOUS_DECISION (lane-aware quick-add, per this feature's spec note under "Correctness points")**: for a grouped board (F224), a quick-add inside a priority or assignee lane defaults the created task's `priority`/`assigneeId` to that lane's value — same "the task's grouped field should match the lane it's sitting in" rule F225's cross-lane drag already establishes. **Scoped out**: tag lanes (many-to-many — a task can sit in several tag lanes at once, so there is no single "the" tag to default a brand-new task's `tags` array to without guessing); the "None" lane also sets no default (nothing to default to). Documented in `components/board/swimlane.tsx`'s own doc comment on `quickAddDefaults`.
- Not optimistic: QuickAdd awaits `createTask` and only reports the real server row via `onCreated`, never a locally-fabricated stub. F249 (owns AS-481, the optimistic behaviour) can wrap this exact `onCreated`/`onError` contract without any rework here — left as a clean seam per the milestone's own instruction.

## Out-of-scope work needed
- **Tag-lane quick-add defaults** (see Decisions above) — F224/F225's tag grouping mode currently gets no lane-aware default at all from quick-add; a task created inside a "urgent-fix" tag lane does not automatically get that tag. A follow-up could add a UI affordance (e.g. a small "+ tag" chip) if product wants this, but there's no unambiguous default to apply silently the way priority/assignee have one.
- **AS-481 (optimistic quick-add)** — explicitly F249's scope, not touched here. The seam (`onCreated`/`onError` callbacks on `QuickAdd`, non-optimistic today) is ready for F249 to build on.
- Nothing else identified as out-of-scope; the spec's Files list (`quick-add.tsx`, `board-column.tsx`, `lib/actions/tasks.ts`) undersold the real wiring surface once F221/F224/F225/F226 were accounted for — I additionally touched `swimlane.tsx`, `board.tsx`, and `lib/validation/tasks.ts`, all necessary to thread real `projectId`/permission/lane-default data through and to widen the status schema respectively, not silent scope creep.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: trimmed-whitespace-only submit treated as empty (spec's own resolved Notes-for-clarification answer, not something I had to choose).
AUTONOMOUS_DECISION: quick-add control hidden entirely (not disabled-with-tooltip) for a caller without create rights, per the feature spec's own more-specific Draft scope line.
AUTONOMOUS_DECISION: lane-aware quick-add defaults implemented for priority/assignee grouping, explicitly scoped out for tag grouping (many-to-many, no unambiguous single default) — see Out-of-scope.

## Notes for the next worker
- `createTaskSchema.status` is now a free-form (1–100 char) string, validated server-side against the calling project's real `project_statuses` rows inside `createTaskForUser` — any future caller passing a status must expect a `{ ok: false, error: "That column no longer exists..." }` result for a name that doesn't match a real column in that project, exactly like `moveTaskStatus` already behaves.
- `QuickAdd`'s `onCreated`/`onError` contract is the intended seam for F249's optimistic-UI work — don't reimplement a parallel create flow there, extend this one.
- No MCP tools used this session (Supabase project state was verified via the existing `.env`-configured admin client inside the integration test itself, per the feature spec's own "MCP at run: none" note).
