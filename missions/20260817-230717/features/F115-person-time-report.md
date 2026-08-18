# F115: person time report

**Milestone:** M9 — Time tracking
**Estimated worker time:** 40 minutes
**Depends on:** F108

## Assertion IDs covered
- AS-173, AS-174

## Draft scope
- A Postgres RPC get_workspace_time_by_person(p_workspace_id uuid, p_start_date date, p_end_date date) returning per-user total minutes (billable/non-billable split), scoped to the workspace, excluding soft-deleted tasks.
- New page app/(workspace)/w/[workspaceSlug]/time/page.tsx (or similar) — a simple report: date-range picker (default: current month) + a table of workspace members with their logged hours. Add a nav entry in the sidebar (components/nav/app-sidebar.tsx) for this — e.g. a clock icon labeled "Time".

## Files (approximate)
supabase/migrations/ (new RPC), app/(workspace)/w/[workspaceSlug]/time/page.tsx (new), components/nav/app-sidebar.tsx (add nav link)

## Clarified implementation
- Default date range: current calendar month, matching typical time-reporting conventions; adjustable via the date pickers.
- Visible to all active workspace members (not admin-only) — reporting transparency is reasonable for a small team, consistent with how comments/tasks aren't restricted by role either.

## Definition of done
- Integration test: correct per-person totals for a given date range, real cross-workspace isolation test (AS-176 territory, but exercised here too since this is the feature that would leak data if RLS/RPC scoping were wrong).
