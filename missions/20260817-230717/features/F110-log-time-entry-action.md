# F110: log time entry action

**Milestone:** M9 — Time tracking
**Estimated worker time:** 30 minutes
**Depends on:** F108

## Assertion IDs covered
- AS-161, AS-162, AS-163

## Draft scope
- lib/actions/time-entries.ts: logTimeEntry(taskId, minutes, billable, entryDate, note?) — Zod validates minutes is a positive integer, entryDate is a valid date; re-checks caller is an active member of the task's workspace (reuse requireActiveMembership pattern); inserts with user_id = caller.

## Files (approximate)
lib/actions/time-entries.ts, lib/validation/time-entries.ts

## Clarified implementation
- Follows the exact Server Action pattern established in lib/actions/tasks.ts: discriminated-union result, Zod schema in a matching lib/validation file, membership re-check via the shared helper.

## Definition of done
- Integration tests: member can log a valid entry; zero/negative minutes rejected; non-member cannot log time on a task outside their workspace (AS-163, real cross-workspace test).
