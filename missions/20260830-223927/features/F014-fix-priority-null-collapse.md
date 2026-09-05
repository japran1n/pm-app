# F014: Fix priority null-collapse + discriminating tests

**Milestone:** M1 — Optimistic UI hardening (follow-up)
**Estimated worker time:** 30 min
**Depends on:** F013

## Assertion IDs covered
- AS-007: Changing task priority in detail sheet updates badge immediately (including clearing to "No priority")
- AS-008: Priority change reverts on server error

## Scope

### Fix 1 — priority null-collapse (blocker)
`components/task/task-detail-sheet.tsx:1434`:
```
value={(optimisticPriority ?? task.priority) ?? NO_PRIORITY_VALUE}
```
When clearing priority (setting to null/undefined), `??` collapses back to `task.priority`, so the badge never updates. Fix: use a sentinel value (e.g. `NO_PRIORITY_VALUE` string constant or the existing enum value) instead of null to represent "no priority" in the optimistic state. Alternatively, use a discriminated union `{ set: true, value: Priority | null } | { set: false }` to distinguish "not yet set" from "explicitly cleared".

Also fix the early-return guard at :986 which has the same conflation.

### Fix 2 — update tests to cover null priority transition
Add test case in `tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx`:
- Start with priority = "high"; change to null/"No priority"; assert badge shows "No priority" before server responds

## Files
`components/task/task-detail-sheet.tsx`, `tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx`

## Notes
- MCP at run: none
- Read scrutiny report for exact line numbers: missions/20260830-223927/milestones/M1-scrutiny.md
