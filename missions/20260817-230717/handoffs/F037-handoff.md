# Handoff: F037 — edit task action

## Status
COMPLETE

## Assertions covered
AS-054: PASS — `editTask` in `lib/actions/tasks.ts` lets any active workspace member edit title/description/priority/due date; verified by `tests/integration/edit-task.test.ts` (non-author member edit, non-member rejection, partial-update, cross-workspace isolation cases).
AS-061: PASS — no per-task ownership/authorship check; only `requireActiveMembership` against the task's owning workspace is checked. Verified by the "AS-054/AS-061: any active workspace member (not just the author) can edit a task" test, where the caller is neither the task's author nor its assignee.
AS-060: PASS — `EditTaskUpdates` (lib/validation/tasks.ts) has no `projectId` field at all; `editTask`'s update payload builder only ever sets `title`/`description`/`priority`/`due_date`. Verified by code inspection (no projectId anywhere in the type or the payload-building code) plus a runtime test that passes a raw object with an extra `projectId`-shaped field (bypassing the TS type via `as unknown as`) and confirms the task's `project_id` is unchanged.

## Files changed
lib/actions/tasks.ts
lib/validation/tasks.ts
tests/integration/edit-task.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint lib/actions/tasks.ts lib/validation/tasks.ts tests/integration/edit-task.test.ts` (0)
`npm run test` (0) — 34 files / 185 tests passed, including 5 new edit-task tests run against the real linked Supabase project
`npm run build` (0)

## Decisions made
- Added `editTaskSchema`/`EditTaskUpdates` to `lib/validation/tasks.ts` as a partial-fields Zod object (`editableFields.partial()`) rather than reusing/extending `createTaskSchema`, because `editTask` must distinguish "field omitted → leave column untouched" from "field explicitly set to null" — a distinction `createTaskSchema`'s always-write-every-column shape doesn't need. `updates: EditTaskUpdates` structurally has no `projectId` key (AS-060) — not a validated-and-rejected field, an absent one.
- `editTask` builds its Supabase update payload with an explicit `"field" in parsed.data.updates` check per field (not `Object.assign`/spread) so only fields genuinely present in the caller's partial update are written, and rejects an update with zero fields present (`{ ok: false, error: "No changes to save." }`) rather than issuing a no-op DB write.
- Reused the exact membership-lookup shape from `assignTask` (task → `projects!inner(id, workspace_id)` → `requireActiveMembership`) for consistency with the rest of the file and because it already handles the soft-deleted-task-as-not-found convention.
- `updatePayload` is typed as an explicit object literal type (not `Record<string, unknown>`) because Supabase's generated `.update()` typing rejects excess/unknown-shaped records — this also makes it structurally impossible for the payload object to ever carry a `project_id` key by accident.

## Out-of-scope work needed
- No UI/form wired up to call `editTask` yet — this feature's scope (per the draft scope and Files section) was the Server Action only. A future feature should add the edit form/UI in the task detail view.
- Assignee editing already exists via `assignTask` (F036) and was deliberately left out of `editTask`'s update shape to avoid overlapping two actions' responsibility for the same column — not a gap, just noting the split for whoever builds the edit UI so it knows to call both actions.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to reject an edit call with an empty `updates` object (`{ ok: false, error: "No changes to save." }`) rather than silently succeeding as a no-op, since the spec didn't address the empty-update case explicitly and a no-op "success" seemed more likely to mask a caller bug than help anyone.

## Notes for the next worker
- `tests/integration/edit-task.test.ts` follows the exact `loadDotEnv`/`describe.skipIf(!haveAdminCreds)` pattern from `tests/integration/assign-task.test.ts` — copy that file's structure for any future task-action tests rather than re-deriving it.
- The AS-060 test seeds a second project (`otherProjectId`) in the *same* workspace purely so the "extra projectId field has no effect" test has a plausible-looking target id to try to smuggle in; it's never actually reachable through `editTask`.
- No MCP tools used at run (registry marks this feature "MCP at run: none").
