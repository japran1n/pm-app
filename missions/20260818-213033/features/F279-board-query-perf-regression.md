# F279: restore the board query's performance budget

**Milestone:** M13 (follow-up — regression found by the orchestrator's full-suite run)
**Estimated worker time:** 45 minutes
**Depends on:** F150, F154, F157
**Parent feature:** F154 (inherits its clarification)

## Assertion IDs covered
- AS-156 (mission 1): `getProjectBoardTasks` p95 stays under the 500ms budget at v1 scale (80 tasks / 4 columns)

## Why this exists
Measured, not suspected: `tests/integration/perf-budget.test.ts` now fails at
`p95=520.6ms min=420.9 max=528.5 mean=474.2` against a 500ms budget. The test passed
throughout mission 1 and passed early in this mission.

The cause is cumulative: `getProjectBoardTasks` gained extra whole-project queries in
F150 (subtask counts), F154 (checklist/completion counts) and F157 (dependency/blocked
state). Each is individually reasonable and none is an N+1 — but every added query is
another network round trip to a remote Supabase project, and the budget is a p95 wall-clock
measurement, so they sum.

This is a mission-1 assertion broken by mission-2 work. It is not optional, and it must not
be "fixed" by raising the budget.

## Draft scope
- Collapse the board's per-render round trips: fold the counts and dependency flags into a
  single Postgres RPC (or a single query with lateral joins) returning one row per task with
  its counts, rather than N separate whole-project queries assembled in TypeScript.
- Keep the existing query's return shape so callers do not change.
- Re-measure and record the before/after p95 in the handoff.
- Do NOT raise `PERF_BUDGET_MS`. If the budget genuinely cannot be met after consolidation,
  report PARTIAL with the measured numbers and a recommendation rather than moving the target.

## Files (approximate)
supabase/migrations/ (new RPC), lib/queries/tasks.ts, tests/integration/perf-budget.test.ts (measurement only, not the threshold)

## Clarified implementation
- Inherits F154's clarification (archetype: logic/db).
- The consolidation must not change RLS behaviour: an RPC must be SECURITY INVOKER, or if
  SECURITY DEFINER, must re-assert workspace membership internally exactly as the mission-1
  timer RPCs do (see F117's hardening).

## Definition of done
- `tests/integration/perf-budget.test.ts` passes with the threshold unchanged.
- Before/after p95 numbers recorded in the handoff.
- Board still renders subtask counts, completion percentage and blocked indicators — verified
  by the existing tests for AS-272, AS-273, AS-283, not by inspection.
