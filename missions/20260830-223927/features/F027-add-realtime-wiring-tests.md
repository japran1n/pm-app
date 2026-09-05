# F027: Add realtime wiring tests for Calendar (AS-019 through AS-022)

**Milestone:** M2
**Depends on:** F009, F010

## Assertion IDs covered
- AS-019, AS-020, AS-021, AS-022

## Root cause

Scrutiny confirmed: deleting the entire `useCalendarRealtime({...})` call from `calendar-day-grid.tsx` leaves all tests green. Wiring has zero coverage.

## Fix

Add component-level tests that:
1. Render the calendar component (or a test harness wrapping it)
2. Mock the Supabase realtime channel to emit fake events
3. Assert the rendered output changes in response to each event type:
   - INSERT with due_date: task appears on correct date
   - UPDATE with new due_date: task moves to new date
   - UPDATE clearing due_date: task disappears
   - DELETE: task disappears
4. Deleting the `useCalendarRealtime({...})` hook call must fail at least one of these tests

Read the existing calendar component and test patterns for reference. Keep tests focused — you don't need to render the full app, just enough to verify the hook is wired and the state updates.

## Files
New file `tests/unit/f027-calendar-realtime-wiring.test.tsx` (or add to existing f009 test file)

## Definition of done
- AS-019-022: each has a wiring test that fails when the hook is removed
