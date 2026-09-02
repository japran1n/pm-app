# Handoff: F007 — Portal realtime reconciler

## Status
COMPLETE

## Assertions covered
AS-020: PASS — 9 tests cover insert-passes/fails (x3 fail modes), update-enters, update-leaves-via-client_visible, update-leaves-via-surface-predicate, update-of-present-row merges, delete-of-present removes by id alone.
AS-024: PASS — delete-of-absent no-op, malformed payload (missing id) dropped, unknown event type returns list unchanged, all via `npx vitest run`.

## Files changed
lib/portal/reconcile-portal-realtime-task.ts
tests/unit/reconcile-portal-realtime-task.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0, 15 pre-existing warnings, 0 new errors)
`npx vitest run tests/unit/reconcile-portal-realtime-task.test.ts` (0, 12 passed)

## Decisions made
- Matched `lib/tasks/reconcile-my-tasks-realtime-task.ts`'s generic-row-type + switch-on-eventType shape exactly, since that reconciler (unlike the board one) already models a caller-supplied membership condition (assignee_id === userId), which is structurally closest to this feature's caller-supplied surfacePredicate.
- Combined predicate logic factored into a private `belongsOnSurface` helper (client_visible === true && deleted_at == null && surfacePredicate(row)) so INSERT/UPDATE both use one source of truth for membership, per the spec.
- Test file lives in `tests/unit/` (not colocated), matching `reconcile-my-tasks-realtime-task.test.ts`'s convention rather than `reconcile-list-realtime-task.ts`, which has no test file in the repo to follow.

## Out-of-scope work needed
F008 (client portal "Waiting on you" hook) and F009 (project page portal hook) both need to import `reconcilePortalRealtimeTask` and wire it into a `use-*-realtime.ts` hook + subscribe helper, following the board/my-tasks pattern (`use-board-realtime.ts` + `subscribe-board-realtime.ts`). Not done here per spec scope (component wiring explicitly excluded).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Named the exported predicate type `PortalSurfacePredicate<T>` and the row type `PortalRealtimeRow` (not specified in the spec) to give F008/F009 a stable, discoverable import surface; no existing naming convention conflicts.

## Notes for the next worker
No MCP tools used — this is a pure function with no live schema/data dependency (Definition of done item 5 confirms no new dependency; item 6 doesn't apply since nothing else calls into this new file yet). When wiring F008/F009, remember DELETE events only carry `id` on `old` under default replica identity — don't try to evaluate the predicate against `event.old`, only use `event.old.id` for removal.
