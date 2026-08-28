# Handoff: W11 — Single authorization seam (withAuthz)

## Status
COMPLETE

## Assertions covered
This is an architecture/refactor worker item (M6, plan.md's W11), not tied to
specific AS-### validation-contract assertions. No new assertions were
assigned in plan.md for W11; the item's own "Done when" criteria are used
instead (see Commands run below for the checks performed).

## Files changed
lib/actions/authz.ts (new)
lib/actions/tasks.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 6 pre-existing warnings unrelated to this change)
`npx vitest run tests/unit` (0) — 179 files / 1392 tests passed
`wc -l lib/actions/tasks.ts` before: 4862, after: 4468 (net -394 lines;
git diff shows +1412/-1598 across the two files because of the doc
comments added inside the withAuthz call sites)

## Decisions made
- `withAuthz`'s design closely follows the mission brief but with one
  deliberate deviation: instead of a generic `loadTaskId`/`workspaceId`
  option pair, `resolveWorkspace(input, admin) => Promise<{ok:true,
  workspaceId, projectId?, visibility?, extra} | {ok:false, error}>` is a
  caller-supplied function. Reason: every action in tasks.ts loads a
  *different* set of columns from `tasks` and uses a *different*
  "is this task findable" filter (e.g. `restoreTask` requires
  `deleted_at IS NOT NULL`, everything else requires `IS NULL`;
  `duplicateTask` needs `tags`/`position`/`estimate_minutes` on the source
  row; `moveTaskStatus` needs `recurrence`/`due_date`/etc. for its
  recurrence-generation step). A single generic query builder covering all
  of these shapes would have been more complex and less readable than the
  original preambles it replaces. `resolveWorkspace` still centralizes
  every AUTH *decision* (membership check, write gate, visibility check) —
  only the *data loading* stays per-action, which is the part that
  legitimately varies.
- `extra` is returned as a single nested field (`{ok:true, ..., extra:
  TExtra}`) rather than spread directly into the `ok:true` branch. Spreading
  `TExtra` into the branch made the return type a non-discriminated union
  from TypeScript's inference perspective (generic intersected into one
  branch of a union defeats control-flow narrowing on `ok`), which produced
  cascading "reduced to never" errors at every call site. Nesting under
  `extra` keeps the union cleanly discriminated on `ok` while still letting
  each action's handler access loaded fields directly off `ctx` (the wrapper
  spreads `resolved.extra` into the context object it builds).
- `writeCheck` defaults to `canWrite` but can be overridden (used by
  `toggleDescriptionChecklistItem`, which gates on `canEditTask` instead,
  matching its original hand-written preamble).
- Every migrated action keeps its exact original public signature (e.g.
  `deleteTask(taskId: string): Promise<DeleteTaskResult>`) via a one-line
  wrapper that calls a private `<name>Impl = withAuthz(...)` object built
  from the original positional arguments — callers (components, tests)
  are unaffected.
- Error message strings, membership/write/visibility gate order, and
  RPC/query bodies going into the DB are byte-for-byte the same rationale
  as the original code — this is a structural refactor, not a behavior
  change. Doc comments explaining *why* each check exists were preserved
  or moved next to their new home in `resolveWorkspace`.

## Migrated actions (10) — before/after LOC per function
Measured as the line span of each function/const block in tasks.ts
(preamble + body), rounded from the diff hunks:
- `deleteTask`: ~141 lines -> ~86 lines (preamble/body now split between a
  short public wrapper + `deleteTaskImpl`'s resolveWorkspace/handler)
- `restoreTask`: ~176 lines -> ~130 lines
- `promoteSubtask`: ~139 lines -> ~95 lines
- `updateTaskTags`: ~134 lines -> ~85 lines
- `reorderTask`: ~138 lines -> ~89 lines
- `moveTaskStatus`: ~255 lines -> ~236 lines (smallest relative win — most
  of its bulk is the recurrence-generation branch, which the preamble
  removal doesn't touch)
- `moveAndReorderTask`: ~218 lines -> ~197 lines
- `getOpenBlockers`: ~139 lines -> ~104 lines
- `toggleDescriptionChecklistItem`: ~155 lines -> ~114 lines
- `duplicateTask`: ~263 lines -> ~250 lines (large body dominated by
  duplication logic, not the auth preamble)

Net effect on the whole file: 4862 -> 4468 lines (-394), even though the
diff shows more insertions than the pure preamble removal would suggest,
because every migrated `resolveWorkspace`/handler retained (and in a few
cases expanded, for clarity) the original inline doc comments explaining
*why* each check exists — nothing was deleted silently.

## Out-of-scope work needed
- The remaining 9 actions in tasks.ts still use the hand-written preamble:
  `createTask` (already thin — delegates to `createTaskForUser`, no
  membership check of its own to migrate), `assignTask`/`setTaskAssignees`/
  `addTaskAssignee`/`removeTaskAssignee` (share `setTaskAssigneesCore`,
  which has extra `filterProjectVisibleUserIds` logic per the mission
  brief's explicit "do NOT migrate" instruction), `editTask` (very large,
  branches on which optional fields are present, includes a mention-
  visibility re-sanitization step — a good next candidate but needs careful
  handling of its multi-field update payload), `getTaskDetail` (a large
  read assembling comments/attachments/subtasks — doable but its
  `resolveWorkspace` would need to carry a very large `extra` object),
  `bulkUpdateTasks`/`bulkDeleteTasks`/`bulkRestoreTasks` (operate over an
  array of task ids with per-id partial success/failure, not a single-task
  authz context — `withAuthz` as designed assumes one task/one workspace
  per call, so these would need either a loop-of-withAuthz-calls
  refactor or a new bulk-oriented variant).
- ~40 other action files across the codebase (per the mission brief's
  estimate) still carry the same hand-written preamble and were entirely
  untouched by this worker, per scope (`lib/actions/tasks.ts` only).
  `withAuthz` is exported from `lib/actions/authz.ts` and ready to be
  imported by a follow-up worker for any of them.
- Suggested follow-up feature: "Migrate lib/actions/tasks.ts's remaining
  action (editTask, bulk* actions) and lib/actions/{comments,attachments,
  projects,...}.ts onto withAuthz." Each file's migration is independent
  and low-risk since `withAuthz` makes no behavior change — only run
  `npx tsc --noEmit` + the relevant test files after each file.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Selected the 10 actions to migrate based on which ones
have (a) a single taskId as their primary target, (b) a standard
requireActiveMembership -> canWrite/canEditTask -> isProjectVisibleToCaller
gate sequence with no unusual mid-function auth re-checks, and (c) no
per-array-item partial success/failure semantics. This matches the mission
brief's own guidance ("Good candidates are actions that: take a single
taskId, do one write, have the standard preamble verbatim") and explicit
exclusion of `setTaskAssigneesCore`. `moveTaskStatus`, `moveAndReorderTask`,
and `duplicateTask` needed more of their loaded task row threaded through
as `extra` than the mission brief's minimal example implied (they use
several columns from the row later in the handler body, not just
workspace/project/visibility) — handled via the generic `extra: TExtra`
field on `AuthzContext` rather than skipping them, since they still fit the
"single taskId, standard gate sequence" criteria.

## Notes for the next worker
- Import `withAuthz` from `@/lib/actions/authz`. See any of the 10 migrated
  actions in `lib/actions/tasks.ts` for the pattern: define a private
  `<name>Impl = withAuthz(schema, options, handler)` above the exported
  function, then have the exported function (with its ORIGINAL signature)
  call `<name>Impl({...})` with the schema's expected object shape.
- `resolveWorkspace` runs BEFORE membership/write/visibility checks — it
  should only ever return `{ok:false, error: "Task not found."}` (never a
  permission-denied-flavored message) for a missing/inaccessible row, since
  `withAuthz` doesn't know yet whether the caller has any right to know the
  row exists.
- If an action's write gate is `canEditTask`/`canDeleteTask` instead of the
  default `canWrite`, pass `writeCheck: canEditTask` (or the relevant
  predicate) in options — see `toggleDescriptionChecklistItem`'s call site.
- No MCP tools were used for this worker — it is a pure application-code
  refactor with no live schema/policy changes (no migration files were
  added or touched).
