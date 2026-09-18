# Handoff: F12 — Discipline estimate write actions

## Status
COMPLETE

## Assertions covered
No assertion IDs were listed in the task prompt for F12; this feature implements the write-action layer (`setDisciplineEstimate`, `clearDisciplineEstimate`, `setDisciplineEstimatesBulk`) that downstream UI/query features depend on. No assertions assigned directly to F12 in the task instructions provided.

## Files changed
lib/actions/architecture/estimates.ts
lib/actions/architecture.ts

## Commands run
`npx tsc --noEmit` (0)

## Decisions made
- Followed the exact auth chain pattern from `lib/actions/architecture/sections.ts`: parse with Zod -> `parseEstimateInput` -> `getCurrentUser` -> `createAdminClient` -> DB lookup of the task (never trust `projectId`/`workspaceId` from args) -> `requireActiveMembership` -> `canWrite` -> mutate -> `revalidatePath('/w', 'layout')`.
- Added a small shared helper `loadTaskForEstimate` inside the new file (not exported) to avoid repeating the task/project/workspace lookup three times across the three actions — kept private to this module, consistent with the "Touches" scope (only this file + barrel).
- Per spec, deliberately did NOT call `revalidatePortalProject` for any of the three actions (spec explicitly says "NO revalidatePortalProject" for this feature, unlike the sections/pages actions which do call it).
- For `setDisciplineEstimatesBulk`, validated every entry's `input` via `parseEstimateInput` before issuing any DB write, returning the same "Invalid format" error as the single-estimate action on first failure, so the whole batch either fully validates or is rejected up front (matches the single-call upsert semantics — one `.upsert()` for all rows, using `onConflict: "task_id,discipline"`).
- Reused `MutationResult` from `./shared` for all three return types, matching the other simple boolean-mutation actions in this directory (createSection uses `MutationWithIdResult`, but these three have no id to return).

## Out-of-scope work needed
None identified — no UI callers, query-side reads, or RLS/migration work were touched; this is purely the actions module per the task's stated scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: No assertion IDs were provided in the task prompt for F12 (unlike the usual "assigned assertions" flow). Proceeded to implement exactly per the detailed field-level spec given (auth chain, upsert/delete shapes, revalidation behavior) since it was fully unambiguous, and left the "Assertions covered" section noting none were assigned rather than inventing IDs.

## Notes for the next worker
- `task_discipline_estimates` table columns used: `task_id`, `project_id`, `discipline`, `minutes`, `note`, `estimated_by`, with a unique constraint on `(task_id, discipline)` (relied on for `onConflict: "task_id,discipline"` upserts) — this schema was assumed to already exist per the task instructions (not verified via Supabase MCP in this worker run, since the task spec gave the exact table/column shape to use and no migration work was in scope).
- `parseEstimateInput`, `setDisciplineEstimateSchema`, `clearDisciplineEstimateSchema`, `setDisciplineEstimatesBulkSchema` all already existed in `lib/validation/architecture.ts` prior to this feature — no validation schema changes were made.
