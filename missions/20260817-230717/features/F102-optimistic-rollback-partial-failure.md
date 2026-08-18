# F102: optimistic rollback partial failure fix

**Milestone:** M5 — Board & drag-and-drop (follow-up)
**Estimated worker time:** 30 minutes
**Depends on:** F045, F046, F047
**Parent:** F047

## Assertion IDs covered
- AS-077

## Draft scope
- scrutiny-validator (M5-scrutiny.md, Finding 2) traced: on a cross-column drag (status change + reposition), moveTaskStatus and reorderTask are independent uncoordinated calls. If moveTaskStatus succeeds but reorderTask then fails, the client-side rollback reverts the VISUAL state to pre-drop, but the server keeps the already-committed status change with a stale (pre-move) position value — client and server disagree about what happened, and the next reload or another viewer's Realtime feed shows the task in the NEW column, contradicting what the acting user's own screen showed after the "failed" drag.
- Fix (pick one, document the choice): (a) merge moveTaskStatus + reorderTask into a single atomic Server Action/RPC that updates both status and position in one statement, so partial failure becomes impossible by construction — this is the cleanest fix and matches the pattern already used for F094/F095's atomic-RPC fixes in M2; OR (b) on reorderTask failure after a successful moveTaskStatus, issue a compensating call to revert the status change too, keeping server state consistent with the reverted client view.
- Recommended: option (a), a single `moveAndReorderTask(taskId, newStatus, newPosition)` action/RPC, called once per drag instead of two separate calls — simpler, atomic, and removes the whole class of partial-failure bugs rather than patching around it.
- Add a test proving: a simulated failure mid-operation leaves NEITHER status nor position changed (true atomicity), not just that the client visually reverts.

## Files (approximate)
lib/actions/tasks.ts, components/board/board.tsx, supabase/migrations/ (if RPC approach chosen), tests

## Notes for clarification
Source: M5-scrutiny.md, Finding 2. Severity: high (real state-inconsistency bug, demonstrated by direct trace).
