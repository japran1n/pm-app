# Handoff: F020 — Create persists all fields

## Status
COMPLETE

## Assertions covered
TT-051: PASS — `createTaskSchema` accepts `startDate`, `estimateMinutes`, `tags`, `billable`; `createTaskForUser` writes them directly onto the `tasks` insert and returns them; the New Task dialog now passes all four through the `createTask` call itself instead of a follow-up write. Verified via `tests/unit/f020-create-task-persists-new-fields.test.ts` (schema-level and mocked-insert-level) and updated `tests/unit/f019-new-task-dialog-two-column.test.tsx` assertions that these values reach `createTask`'s own argument list.

## Files changed
lib/validation/tasks.ts
lib/tasks/create.ts
lib/actions/tasks/create.ts
components/task/new-task-dialog.tsx
tests/unit/f020-create-task-persists-new-fields.test.ts
tests/unit/f019-new-task-dialog-two-column.test.tsx
tests/unit/f248-quick-add.test.tsx
tests/unit/f249-quick-add-optimistic.test.tsx

## Commands run
`npx tsc --noEmit -p .` (0)
`npx vitest run tests/unit/f019-new-task-dialog-two-column.test.tsx tests/unit/f020-create-task-persists-new-fields.test.ts tests/unit/f017-tasks-billable-schema.test.ts tests/unit/f248-quick-add.test.tsx tests/unit/f249-quick-add-optimistic.test.tsx` (0, 31 passed)
`npx vitest run tests/unit` (exit 0 process; 141 pre-existing failures unrelated to this feature — confirmed identical failure set present on `main` before this change via `git stash` + targeted re-run of the same files: `list-due-date-cell-optimistic`, `route-loading-skeletons`, `th-extraction`, `th-preview-pane`, all fail identically on a clean checkout)
`npx eslint <touched files>` (0 errors, 3 pre-existing unused-arg warnings in a mocked `@/components/ui/select` shim unrelated to this feature)

## Decisions made
- Extended `createTaskSchema` (lib/validation/tasks.ts) with `startDate`, `estimateMinutes`, `tags`, mirroring `editTaskSchema`'s own field definitions and `updateTaskTagsSchema`'s tags shape exactly, plus the same `startDate <= dueDate` cross-field `.superRefine` check `editTaskSchema` already has (defense-in-depth alongside the DB CHECK).
- Extended `createTaskForUser` (lib/tasks/create.ts) to accept these four fields and write them onto the SAME `tasks` insert, replacing the previous "insert first, then a follow-up `editTask`/`updateTaskTags` call" shape F019 had used (F019's own handoff explicitly scoped that two-step shape as a workaround for `createTask` not yet accepting these fields — this feature closes that gap directly, as instructed by F020's Clarified implementation).
- Extended the `createTask` Server Action (lib/actions/tasks/create.ts) with the same four fields as new **trailing optional positional parameters**, appended after `taskTypeId` — every existing positional caller (quick-add, subtask list, seed script, extension route, and ~15 test files) keeps compiling and behaving unchanged since none of them pass anything in those new positions.
- Updated `components/task/new-task-dialog.tsx` to pass `startDate`, `estimateMinutes`, `tags`, `billable` directly on the single `createTask` call, and removed the now-redundant follow-up `editTask`/`updateTaskTags` calls and their now-unused imports.
- In `createTaskForUser`'s insert payload, `start_date`/`estimate_minutes` are written as explicit `null` when omitted (mirroring the wrapper's own `input.startDate ?? null` normalization, consistent with how every other nullable field in this function is handled), while `tags`/`billable` are omitted entirely from the payload when not supplied, so their DB defaults (`'{}'`/`true`) apply untouched — both have the identical effect on the resulting row.
- Updated `tests/unit/f019-new-task-dialog-two-column.test.tsx`'s two tests that asserted the old `editTask`/`updateTaskTags` follow-up calls, since that call path no longer exists after this change — they now assert the values reach `createTask`'s own argument list instead, and that `editTask`/`updateTaskTags` are NOT called.
- Updated `tests/unit/f248-quick-add.test.tsx` and `tests/unit/f249-quick-add-optimistic.test.tsx` mock fixtures (`CreateTaskResult`-shaped objects) to include the four new required fields, since `CreateTaskResult`'s type grew — no behavioral change in those tests, purely a type-shape fix.

## Out-of-scope work needed
None identified beyond this feature's own scope. `app/api/extension/tasks/route.ts` and `components/board/quick-add.tsx`/`components/task/subtask-list.tsx` still only ever pass the pre-existing positional arguments to `createTask` — they were not required by this feature's spec to also expose start date/estimate/tags/billable at their own call sites, and doing so was not in F020's Files/Touches scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to also simplify `new-task-dialog.tsx`'s `handleSubmit` (removing the F019-era follow-up `editTask`/`updateTaskTags` writes) rather than leaving both the old two-step writes AND the new direct fields in place redundantly — the feature spec's step 5 explicitly asked to "verify the form submit handler collects and passes all these values ... If any field's value isn't being passed, fix it," and leaving a dead/redundant second write in place would have been a correctness/duplicate-write bug (e.g. tags would have been written twice, once via `createTask` and once via `updateTaskTags`) rather than a fix.

## Notes for the next worker
- `createTaskSchema`'s cross-field `startDate`/`dueDate` ordering check was added via `.superRefine` — note the exported `createTaskSchema` is now a `ZodEffects`-wrapped object rather than a bare `ZodObject`; `.safeParse` continues to work identically for every existing caller.
- No MCP usage was needed for this feature — it is pure application logic over an existing schema/columns (`tasks.start_date`, `tasks.estimate_minutes`, `tasks.tags`, `tasks.billable` all already exist per F166/F236/F041/F017's prior migrations), verified by reading the existing column list in `lib/actions/tasks/edit.ts`'s own select statement rather than a live schema check.
