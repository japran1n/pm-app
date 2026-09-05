# Handoff: F010 — Calendar realtime reconciliation helper

## Status
COMPLETE

## Assertions covered
AS-019: PASS — `reconcileCalendarRealtimeEvent` UPDATE-with-changed-`due_date` branch; test "moves a task to its new date bucket when UPDATE changes due_date" (tests/unit/f009-calendar-realtime-subscription.test.ts)
AS-020: PASS — INSERT-with-`due_date` branch; test "appends a new task with a due_date on INSERT (AS-020)"
AS-021: PASS — UPDATE-clearing-`due_date` and DELETE branches; tests "removes a task from the calendar when UPDATE clears due_date" and "removes a task on DELETE (AS-021)"

## Files changed
(none — verified existing implementation and tests satisfy this feature's scope; no code or test changes were required)

## Commands run
`npx vitest run tests/unit/f009-calendar-realtime-subscription.test.ts` (0, 14/14 passed)
`npx tsc --noEmit` (0)
`npm run lint` (0 errors, 13 pre-existing warnings unrelated to this feature)

## Decisions made
- F009's handoff and the header comment in `lib/calendar/reconcile-realtime-task.ts` both explicitly document that F009 already built and shipped the pure reconciliation helper this feature was assigned (it could not ship a working calendar realtime subscription without one). Rather than build a second, parallel implementation or a pure rename shim, I verified F009's existing artifact actually satisfies F010's assigned assertions end-to-end and left it in place — per this feature's own instruction: "If the reconciler and tests are already complete and adequate, set status COMPLETE ... without making unnecessary changes."
- Verified `lib/calendar/reconcile-realtime-task.ts` is a pure function with no DOM/React dependencies: its only imports are type-only imports (`CalendarTask` from `lib/queries/calendar`, `CalendarRealtimeEvent` from `lib/tasks/subscribe-calendar-realtime`, `DateOnly` from `lib/time/user-timezone`); no `useState`/`useEffect`/`document`/`window`/React imports anywhere in the file. It takes `(byDate, event, visibleProjectIds)` and returns a new `CalendarTasksByDate` — fully unit-testable without a browser or React runtime, matching this feature's "pure function" requirement.
- Confirmed all four required cases are covered by existing tests in `tests/unit/f009-calendar-realtime-subscription.test.ts` (`describe("reconcileCalendarRealtimeEvent (AS-019, AS-020, AS-021, AS-022)")`):
  - INSERT with `due_date` set -> task added to correct date bucket ("appends a new task with a due_date on INSERT (AS-020)")
  - UPDATE with `due_date` changed -> task moved to new date bucket ("moves a task to its new date bucket when UPDATE changes due_date")
  - UPDATE clearing `due_date` -> task removed ("removes a task from the calendar when UPDATE clears due_date")
  - DELETE -> task removed ("removes a task on DELETE (AS-021)")
  Plus adjacent edge-case tests beyond the required four: INSERT with no `due_date` is a no-op, soft-delete via `deleted_at` on an UPDATE payload removes the task, and malformed/partial payloads are ignored rather than acted on.
- Did not touch `lib/tasks/reconcile-calendar-realtime-task.ts` (F010's originally-planned file path per the spec) since F009 already placed the working implementation at `lib/calendar/reconcile-realtime-task.ts` and it is wired into production code (`components/calendar/calendar-day-grid.tsx`); creating a second file at the originally-planned path would either duplicate logic or require a risky rename/re-wire with no functional benefit, which this feature's own instructions guard against ("do not make unnecessary changes").

## Out-of-scope work needed
(none beyond what F009's handoff already flagged — see that handoff's "Out-of-scope work needed" section for the mobile agenda-list Server Component gap and the deferred live two-tab Realtime e2e verification, both outside this feature's assigned assertions)

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Treated F009's existing `lib/calendar/reconcile-realtime-task.ts` + `tests/unit/f009-calendar-realtime-subscription.test.ts` as already satisfying this feature's full scope after independently verifying (a) all four required test cases exist and pass, and (b) the helper is a pure, DOM/React-free function — rather than creating a duplicate file at the spec's originally-planned path, per this feature's explicit instruction to avoid unnecessary changes when the work is already complete and adequate.

## Notes for the next worker
- The canonical reconciler for calendar realtime task events lives at `lib/calendar/reconcile-realtime-task.ts` (exported as `reconcileCalendarRealtimeEvent`), not at any `lib/tasks/reconcile-calendar-realtime-task.ts` path a spec might reference — if a future feature imports from the latter path, redirect it to the former.
- No MCP tools were used for this feature — it involved no live external service state, only reading and verifying existing repo code/tests.
