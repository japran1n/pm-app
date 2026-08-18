# Handoff: F036 — assign task action

## Status
COMPLETE

## Assertions covered
AS-051: PASS — "an active workspace member can assign a task to another active member of the same workspace" (tests/integration/assign-task.test.ts)
AS-052: PASS — "assigning a task to a user who is not a member of the task's workspace is rejected" (tests/integration/assign-task.test.ts)
AS-053: PASS — "an active workspace member can unassign a task (assignee set to null)" (tests/integration/assign-task.test.ts)

## Files changed
lib/actions/tasks.ts
lib/validation/tasks.ts
tests/integration/assign-task.test.ts
missions/20260817-230717/handoffs/F036-handoff.md

## Commands run
`npx tsc --noEmit` (0)
`npx eslint lib/actions/tasks.ts lib/validation/tasks.ts tests/integration/assign-task.test.ts` (0)
`npx vitest run tests/integration/assign-task.test.ts tests/integration/create-task.test.ts` (0, 9 passed)
`npx vitest run` (0, 180 passed / 33 files)
`npm run build` (0)

## Decisions made
- Added `assignTaskSchema` to `lib/validation/tasks.ts` alongside `createTaskSchema`, keeping the "Zod schema in lib/validation/<entity>.ts" convention from the clarified spec. `assigneeId` is `.nullable()` (not `.optional()`) since `null` is a meaningful, required-to-accept input (unassign), distinct from "field omitted".
- Looked up the task's owning workspace via `tasks -> projects!inner(workspace_id)` in a single query, mirroring createTask's pattern of never trusting a workspace id supplied by the caller — the workspace is always derived server-side from the task's real project.
- A soft-deleted task (`deleted_at` not null) is treated as "not found", matching createTask's convention for soft-deleted projects.
- AS-052's assignee-membership check is only skipped when `assigneeId === null` (explicit unassign); any non-null assigneeId — including one equal to the caller's own id — is independently re-verified via `requireActiveMembership` against the task's real workspace, never inferred from "the caller is already a member so any id they submit must be fine."
- Used the admin client for the update itself (same rationale as createTask: RLS on `tasks` already permits this for a verified active member; the admin client is used only because membership was already independently re-checked in-action, consistent with the rest of this file).
- Reused the exact test scaffolding pattern (loadDotEnv, supabase mocks, skipIf) from tests/integration/create-task.test.ts for consistency and to avoid introducing a second test-setup convention.

## Out-of-scope work needed
- None identified specific to F036. AS-054 (task editing including assignee) and AS-055/AS-056/AS-057 (soft-delete) are separate assigned features per validation-contract.md and were not touched.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none beyond the standard clarified-spec pattern already established by F035/createTask, which this feature mirrors)

## Notes for the next worker
- `assignTask`'s workspace lookup uses `tasks!inner` join syntax (`projects!inner(id, workspace_id)`) rather than a second round-trip query — Supabase JS may return the joined relation as either an object or a single-element array depending on client version/config, so the code normalizes with `Array.isArray(taskRow.projects) ? taskRow.projects[0] : taskRow.projects` before reading `workspace_id`. Verified against the real linked Supabase project via the integration test, not just typechecking, since this is exactly the kind of thing that types alone can get wrong.
- No MCP tools were needed for this feature (mcp-registry.md / feature spec both say "MCP at run: none").
