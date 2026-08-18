# F114: project time totals

**Milestone:** M9 — Time tracking
**Estimated worker time:** 30 minutes
**Depends on:** F108

## Assertion IDs covered
- AS-172, AS-174

## Draft scope
- A Postgres RPC or query (SECURITY INVOKER, matching F071/F072's pattern) get_project_time_totals(p_project_id uuid) returning billable_minutes and non_billable_minutes, summed across all of the project's non-deleted tasks' time_entries (AS-174: excludes soft-deleted tasks).
- UI: add to the project detail header (near the Board/List tabs) a small stat showing "32.5h logged (18h billable)".

## Files (approximate)
supabase/migrations/ (new RPC), lib/queries/time-entries.ts, app/(workspace)/w/[workspaceSlug]/projects/[projectId]/layout.tsx (header addition)

## Clarified implementation
- Follows F071/F072's SECURITY INVOKER + RLS pattern exactly — no elevated-privilege aggregation, relies on the caller's own RLS-scoped visibility into time_entries.

## Definition of done
- Integration test: totals correctly split billable/non-billable; a soft-deleted task's logged time is excluded from the total (real test, not just code inspection).
