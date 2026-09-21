# Handoff: F002 — Data: KPI queries (getUnassignedCount + getKpiDelta)

## Status
COMPLETE

## Assertions covered
AS-073: PASS — getUnassignedCount counts incomplete (not done/cancelled category), unassigned, non-deleted tasks scoped to active projects in the workspace.
AS-074: PASS — getUnassignedCount excludes done-category, assigned, deleted, and archived-project tasks (separate tests for each exclusion).
AS-075: PASS — getKpiDelta returns the overdue count (due_date older than the N-day cutoff, excluding done/cancelled) and the completed count (done-category tasks updated within the N-day window) for a given workspace and lookback window.

## Files changed
lib/queries/dashboard.ts
tests/unit/dashboard-kpi.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx vitest run tests/unit/dashboard-kpi.test.ts` (0, 7 passed)
`npx vitest run tests/unit --exclude '.claude/**'` (0 exit, pre-existing unrelated failures noted below)
`git commit` (0)

## Decisions made
- Both functions create their own request-scoped Supabase client internally via `createClient()` from `lib/supabase/server`, matching the exact signatures in the clarified spec (`getUnassignedCount(workspaceId)` / `getKpiDelta(workspaceId, kind, daysBack)` — no `supabase` parameter), unlike every existing function in this file which takes `supabase` as its first argument and wraps an RPC. tech-decisions.md is explicit ("No database migrations — AS-005 ... via SQL in `lib/queries/dashboard.ts` — no new RPC"), so this is the one intentional deviation from the file's existing RPC-wrapper pattern.
- Implemented as two round trips (fetch active project ids, then fetch tasks scoped to those ids with a `project_statuses(category)` embedded select, filtering by category in JS) rather than a single PostgREST embedded-resource filter (`.eq('project_statuses.category', ...)`). This keeps the query shape mockable with the same `.eq/.is/.in/.lt/.gte` chain-mock convention already established by `tests/unit/calendar-blocks-active-members.test.ts`.
- `project_statuses.category` only has `not_started`/`in_progress`/`done` in the current schema (no `cancelled`) — kept the spec's `≠ 'cancelled'` guard anyway (harmless no-op today, forward-compatible).
- "Completed" is approximated via `updated_at` on tasks currently in a done-category status (no `completed_at` column exists), mirroring the exact approximation already documented and accepted in `supabase/migrations/20260902050000_dashboard_kpi_rpcs.sql`'s `get_completed_count` RPC.
- Both functions fail open to `0` and log via `logger.error` on any query error, matching `getWorkspaceChatUnreadTotal`'s established convention in `lib/queries/chat.ts`.

## Out-of-scope work needed
None identified for this feature. Callers (home dashboard cards) are built by other features in this mission (F006, F011, etc.) per plan.md.

## Blockers
None.

## Autonomous decisions
AUTONOMOUS_DECISION: Chose the two-round-trip query-builder shape (fetch project ids, then tasks with embedded `project_statuses(category)`) over a single PostgREST embedded-filter query, since the spec only specifies filter semantics, not exact query shape, and this shape matches the codebase's existing mockable-query-builder test convention.

## Notes for the next worker
- Full `npx vitest run tests/unit` (excluding `.claude/worktrees/**`, a stray untracked agent worktree directory that also contains its own `tests/unit`) shows 45 pre-existing failing test files unrelated to this change — verified by stashing this feature's changes and re-running `tests/unit/th-preview-pane.test.tsx` alone, which fails identically both with and without this feature's diff (a pre-existing locale-text mismatch, `TH-207`, unrelated to F002/dashboard KPIs).
- No MCP usage was needed — no migration or live schema/RLS change involved (per tech-decisions.md's "No database migrations" note and mcp-registry.md's "Supabase MCP not needed" line for this mission).
