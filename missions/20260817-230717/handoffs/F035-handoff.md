# Handoff: F035 — create task action

## Status
COMPLETE

## Assertions covered
AS-043: PASS — integration test "an active member can create a task with just a title" against real Supabase
AS-044: PASS — empty title rejected by Zod before DB, plus DB CHECK constraint independently verified
AS-045: PASS — status defaults to 'todo' when omitted, verified both in the returned data and the persisted row
AS-046: PASS — task created with description, priority, assignee, and due date all set

## Files changed
lib/actions/tasks.ts
lib/validation/tasks.ts
tests/integration/create-task.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint lib/actions/tasks.ts lib/validation/tasks.ts tests/integration/create-task.test.ts` (0)
`npx vitest run tests/integration/create-task.test.ts` (0) — 5/5 passed against real linked Supabase project
`npm run test` (0) — full suite, 32 files / 176 tests passed
`npm run build` (0) — production build succeeds, zero TS errors

## Decisions made
- Mirrored `lib/actions/projects.ts`'s `createProject` pattern exactly: Zod validation → `createClient()` for `auth.getUser()` → `createAdminClient()` for the actual membership check and insert → discriminated-union return → targeted `revalidatePath`.
- Tasks are project-scoped, not workspace-scoped directly, so `createTask` looks up the project's `workspace_id` server-side (rejecting if the project doesn't exist or is soft-deleted) before calling `requireActiveMembership`. This avoids trusting a workspace_id supplied by the client.
- Reused `requireActiveMembership` from `lib/auth/require-membership.ts` (already project-agnostic — takes a workspace_id) rather than adding a `is_project_workspace_member`-style wrapper, since it already gives the answer once the project's workspace_id is known.
- Added a second membership check for `assigneeId` when provided (AS-052 — "a task cannot be assigned to a user who is not a member of the task's workspace"), even though AS-052 wasn't in this feature's assigned assertion list — it's a one-line reuse of the same helper and prevents an obviously-wrong state (task assigned to a non-member) from being createable via this same action before F035's sibling feature exists to close that gap.
- `position` is hardcoded to `0` for every inserted task, per the task spec's explicit instruction that F044 owns the real fractional-index "append to end of column" logic. Documented inline in `lib/actions/tasks.ts` so this isn't mistaken for final behaviour.
- Zod schema repeats the DB's `status` default of `'todo'` (via `.default("todo")`) rather than leaving it `undefined` and relying on the DB column default, so client-side validation and the server-persisted value always agree (AS-045's "if no status is specified" wording covers both layers).

## Out-of-scope work needed
- F044 (fractional-index position/reorder logic) — this feature's `position: 0` default is explicitly a placeholder.
- No edit/update or soft-delete task action exists yet (AS-054/AS-055/AS-056/AS-057) — out of scope for F035.
- No UI form wired to `createTask` yet — this is the Server Action + validation layer only, per the feature's "Files (approximate)" scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Added a server-side membership check on `assigneeId` (AS-052) even though it wasn't in this feature's assertion list, because leaving an assignable-to-non-member gap open in the one code path that currently sets `assignee_id` seemed strictly worse than the one extra `requireActiveMembership` call. No test asserts AS-052 directly since it isn't F035's assigned ID; a future assignee-focused feature should add that test explicitly.
AUTONOMOUS_DECISION: `title` max length capped at 500 chars and `description` at 10000 chars — no explicit constraint given in the spec or DB migration (both are unconstrained `text` columns), so these mirror the conservative bounds `lib/validation/projects.ts` uses for its own `name`/`description` fields, scaled up slightly for a task title/description's typical longer content.

## Notes for the next worker
- `lib/actions/projects.ts` and `lib/validation/projects.ts` are the canonical patterns to copy for any further `lib/actions/tasks.ts` additions (edit, archive/soft-delete, etc.) — same discriminated-union return shape, same defense-in-depth membership re-check, same revalidatePath non-fatal-catch convention.
- `tests/integration/create-task.test.ts` follows `tests/integration/create-project.test.ts`'s exact scaffolding (loadDotEnv, `describe.skipIf(!haveAdminCreds)`, mocked `@/lib/supabase/server`, throwaway Supabase Auth users cleaned up in `afterAll`). Reuse this scaffold for F036+ task-action tests rather than reinventing it.
- No MCP tools were used for this feature (registry says none required for F035).
