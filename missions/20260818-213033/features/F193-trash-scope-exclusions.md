# F193: trashed items stay out of every view

**Milestone:** M14 — Rich text, recurrence, templates, bulk actions & trash
**Estimated worker time:** 30 minutes
**Depends on:** F188

## Assertion IDs covered
- AS-350: trashed items are excluded from board, list, search, dashboard, and My Tasks

## Draft scope
- Sweep every query, RPC, and realtime reconciliation path for the `deleted_at is null` filter, including the new tables added by this mission (checklist items, dependencies, assignees, watchers, activity).
- Add the filter to the shared query helper introduced in F144 so new surfaces inherit it.
- One integration test per surface.

## Files (approximate)
lib/queries/*.ts, supabase/migrations/ (RPC updates), lib/board/reconcile-realtime-task.ts

## Notes for clarification
- Mission 1 shipped a soft-delete leak into the dashboard; assume another one exists and go looking rather than spot-checking.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: audit). Full rationale: `missions/20260818-213033/clarifications/F193-clarification.md`._

- read every file in the feature's Files scope, compare against the assigned assertions, fix in place, and list what was checked in the handoff.
- Validation: an automated test per assertion where feasible, plus a written enumeration of what was inspected for structural/negative assertions.
- Access control: only where an assigned assertion is about access; policy changes come with an RLS integration test.
- Failure handling: fix it inside this feature's file scope and record it in the handoff's Decisions Made; gaps outside scope go to Out-of-scope work needed.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Mission 1 shipped a soft-delete leak into the dashboard; assume another one exists and go looking rather than spot-checking.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-350) has a named test or a written verification note.
