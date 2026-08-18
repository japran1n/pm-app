# F113: task time ui

**Milestone:** M9 — Time tracking
**Estimated worker time:** 40 minutes
**Depends on:** F110, F111, F112

## Assertion IDs covered
- AS-171

## Draft scope
- components/task/time-tracking.tsx: within task-detail-sheet.tsx, a new section showing: total logged time for this task (sum of time_entries.minutes, formatted as "Xh Ym"), a start/stop timer button (reflects the current user's active timer state via F111's getActiveTimer, shows a live-updating elapsed counter while running), a "Log time manually" mini-form (minutes, billable toggle, date, note), and a list of this task's time entries with edit/delete affordances (author/admin only, per F112).
- components/task/task-card.tsx: add a small time indicator (e.g. clock icon + total hours) if the task has any logged time, matching the existing overdue-indicator's visual pattern (icon + text, not color-only).

## Files (approximate)
components/task/time-tracking.tsx (new), components/task/task-detail-sheet.tsx (wire in), components/task/task-card.tsx (small addition)

## Clarified implementation
- The live-updating timer counter is a client-side setInterval purely for DISPLAY (re-rendering "elapsed: 12:34" every second) — the source of truth remains the server's started_at, recomputed correctly on every stop/reload, not accumulated client-side.

## Definition of done
- Unit test for the elapsed-time formatting helper (minutes → "Xh Ym" display string).
- Integration test: task detail sheet shows the correct total after logging entries.
