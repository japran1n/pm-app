# Handoff: W7a — Make setTaskAssigneesCore atomic

## Status
COMPLETE

## Assertions covered
No assertion IDs were assigned to this task — this is an atomicity/reliability hardening fix, not a validation-contract feature.

## Files changed
lib/actions/tasks.ts
lib/supabase/database.types.ts
supabase/migrations/20260905050000_set_task_assignees_atomic.sql

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 6 pre-existing warnings unrelated to this change)
`npx vitest run tests/unit` (0) — 179 files / 1392 tests passed

## Decisions made
- Created `public.set_task_assignees_atomic(p_task_id, p_desired_user_ids, p_assigned_by)` as a `SECURITY DEFINER` plpgsql function so the DELETE (remove stale assignees), INSERT (add new assignees, `on conflict (task_id, user_id) do nothing`), and mirror recompute (`tasks.assignee_id`) all run inside one Postgres transaction. A failure at any step now rolls back the whole call instead of leaving a partially-stripped assignee set.
- The RPC's mirror tie-break (`order by created_at, user_id limit 1`) intentionally mirrors `resolveMirrorAssigneeId`'s JS logic (earliest `created_at`, then lowest `user_id`) exactly, so behavior is unchanged from the caller's perspective.
- `lib/actions/tasks.ts` (`setTaskAssigneesCore`, ~lines 564–586): replaced the DELETE block, the INSERT block, and the `syncMirrorAssigneeId` call with a single `admin.rpc("set_task_assignees_atomic", ...)` call. On `rpcError`, returns the same generic `{ ok: false, error: "Something went wrong..." }` shape as before, preserving existing error-handling behavior for callers/tests.
- Added a `set_task_assignees_atomic` entry to the generated `Functions` map in `lib/supabase/database.types.ts` (Args: `p_assigned_by`, `p_desired_user_ids`, `p_task_id`; Returns: `string`) — required for `admin.rpc(...)` to typecheck since this repo hand-maintains/generates this file and it didn't yet know about the new function.
- Did not touch `syncMirrorAssigneeId` itself — it's still used elsewhere in the file (line ~4331, a different code path), so it was left as-is per the "don't touch anything else" scope.

## Out-of-scope work needed
None identified. This was a narrowly-scoped atomicity fix for one function.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: The migration returns `uuid` (nullable) as the mirror value; in TS this surfaces as `string | null` per Supabase's uuid-to-string mapping, matching the existing `mirror` variable's prior type from `syncMirrorAssigneeId`'s return signature, so no downstream code needed changes.

## Notes for the next worker
- The new migration file is `supabase/migrations/20260905050000_set_task_assignees_atomic.sql`. It has not been applied to any live Supabase project by me — no MCP was used for this task since the spec only asked for the migration file + code change; the mcp-registry wasn't consulted because this is a pure schema/code change with no live-state introspection needed for the task as scoped. If the orchestrator's pipeline auto-applies pending migrations before running tests/deploys, this will pick it up on the next `supabase db push`/deploy step.
- Verified no existing unit test directly asserts on the old DELETE/INSERT call shape for `setTaskAssigneesCore` (grepped `tests/unit` for `setTaskAssignees` combined with delete/insert/rpc — no hits), so the RPC swap required no test updates.
