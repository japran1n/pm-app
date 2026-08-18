# Handoff: F050 — board soft delete filter

## Status
COMPLETE

## Assertions covered
AS-081: PASS — verified via new test tests/unit/board-soft-delete-filter.test.ts (3 tests) plus pre-existing coverage in tests/unit/board-realtime-subscription.test.ts ("removes a task whose UPDATE payload has deleted_at set (soft delete)") and the integration test tests/integration/board-columns-render.test.ts which seeds soft-deleted rows against a real Supabase project.

## Files changed
tests/unit/board-soft-delete-filter.test.ts

## Commands run
`npx vitest run tests/unit/board-soft-delete-filter.test.ts` (0)
`npm test` (0) — 265/265 tests passed, 48 files
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npm run build` (0)

## Decisions made
- Investigated both halves of the assigned scope before writing anything:
  1. `lib/queries/tasks.ts` (`getProjectBoardTasks`, F042) already applies `.is("deleted_at", null)` in the query, in addition to RLS (`tasks_select_active_members`) already excluding soft-deleted rows. No change needed.
  2. `lib/board/reconcile-realtime-task.ts` (F049) already handles the exact case this feature worries about: a soft-delete arrives over Realtime as an `UPDATE` event (`eventType: "UPDATE"`, `new.deleted_at` set) — not a `DELETE` event — and the function already checks `if (row.deleted_at) { return tasks.filter(...) }` *before* falling through to the update-in-place branch, so it correctly produces a removal, not a stale update-in-place. No change needed.
- Since both halves were already correctly implemented (F042 and F049 anticipated this requirement and the F049 code comments explicitly call out "AS-081-style"), this feature's actual work was: (a) confirm both with a fresh read of the code and reasoning about the Postgres/Realtime event-type distinction, and (b) satisfy the DoD's "evidence artifact: test output referencing the assertion ID by name" requirement, since no existing test named AS-081 explicitly. Added `tests/unit/board-soft-delete-filter.test.ts` with three tests: a source-level check that the query filters `deleted_at IS NULL`, a test that a soft-delete UPDATE event is treated as a removal (not update-in-place, checking the row is fully gone rather than merged with stale data), and an edge case where the soft-deleted task was never tracked locally (proving it doesn't fall through to the INSERT/append branch).
- Followed the existing source-inspection test pattern (see `tests/unit/board-move-status-wiring.test.ts`) for the query-filter check, since this repo's vitest runs with `environment: "node"` and no live DB creds are available in the unit suite (the DB-backed version of the same guarantee already exists in `tests/integration/board-columns-render.test.ts`).
- Did not modify `lib/queries/tasks.ts` or `lib/board/reconcile-realtime-task.ts` — both already correct, and the worker rules prohibit touching files outside the feature's actual scope of work.

## Out-of-scope work needed
None identified.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: No code fix was needed for either half of the spec (query filter, Realtime reconciliation) since both were already correctly implemented by F042 and F049. Interpreted the feature's actual deliverable as verification plus the missing AS-081-named test evidence, per the DoD's explicit evidence requirement, rather than a no-op.

## Notes for the next worker
- `reconcileTask` in `lib/board/reconcile-realtime-task.ts` checks `row.deleted_at` immediately after extracting `event.new`, before the insert/update branching — this is the key line that makes soft-delete-via-UPDATE behave as a removal rather than an update-in-place. Any future refactor of this function must preserve that ordering.
- `getProjectBoardTasks` in `lib/queries/tasks.ts` filters `deleted_at IS NULL` even though RLS (`tasks_select_active_members`) already enforces it — this is intentional per tech-decisions.md's soft-delete convention ("all SELECTs used by the app ... filter deleted_at IS NULL"), so don't remove it as "redundant" in a future cleanup pass.
- No MCP tools used (feature spec: "MCP at run: none").
