# Handoff: W7b — Make duplicateTask atomic

## Status
COMPLETE

## Assertions covered
No specific AS-IDs assigned to this atomicity-hardening task; scope is a targeted reliability fix to `duplicateTask` per the mission's atomicity worklist (W7b), verified via the full unit test suite.

## Files changed
lib/actions/tasks.ts
lib/supabase/database.types.ts
supabase/migrations/20260905060000_duplicate_task_atomic.sql

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0, 6 pre-existing unrelated warnings)
`npx vitest run tests/unit` (0, 179 files / 1392 tests passed)

## Decisions made
- New `duplicate_task_atomic(p_source_task_id, p_new_task_id)` plpgsql function copies `checklist_items` and `task_assignees` for the new task in one transaction, mirroring the pattern used by `set_task_assignees_atomic` (SECURITY DEFINER, `search_path = ''`, REVOKE from public / GRANT to authenticated).
- `assigned_by` on copied assignee rows is taken from the source row's `assigned_by` (per spec instructions), not from the acting user — this differs slightly from the old code's behavior (which always set `assigned_by: user.id`), but matches the explicit Step 1 instruction "assigned_by = the source row's assigned_by."
- On RPC failure, the newly-inserted task row is deleted (`admin.from("tasks").delete().eq("id", inserted.id)`) so the caller never sees `ok: true` with a partially-duplicated task, and the function returns the existing generic error message.
- `syncMirrorAssigneeId` and the notification fan-out only run when `cloned.assigneeIds.length > 0`, preserving prior behavior; both still only execute after the RPC succeeds.
- Added `duplicate_task_atomic` to `database.types.ts` `Functions` map with `Args: { p_new_task_id: string; p_source_task_id: string }` and `Returns: undefined` (function returns `void`).

## Out-of-scope work needed
None identified within this function. The rest of `tasks.ts` was left untouched per instructions.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept `assigned_by` sourced from the original assignee row (not the acting user) inside the RPC, since the task spec explicitly required this; flagging here in case product intent was actually "assigned_by = duplicating user" — worth confirming with a future scrutiny pass if this surfaces as unexpected in UI (e.g., "assigned by" attribution shown to end users).

## Notes for the next worker
- Migration file follows the exact security/grant pattern already used by `20260905050000_set_task_assignees_atomic.sql` in this repo — read that file for a working example of the RLS-safe RPC pattern before writing new atomic RPCs.
- No MCP tools used for this task; migration was written directly and the local test suite exercises `duplicateTask`'s behavior functionally through mocked Supabase clients, so it wasn't necessary to introspect live schema.
