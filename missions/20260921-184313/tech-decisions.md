# Tech Decisions — Home Dashboard Redesign

_Mission: 20260921-184313_ _Written: 2026-09-21_

---

## Stack (no changes)

- **Framework:** Next.js App Router (existing)
- **UI:** Supabase DS — tokens in `globals.css`, Tailwind utilities
- **DB client:** Supabase SSR client (`createClient` from `@/lib/supabase/server`)
- **Auth:** Supabase Auth session, role from `workspace_members.role`
- **Type-safety:** TypeScript strict; all new queries typed with `export type`
- **Testing:** Vitest unit tests in `tests/unit/`

## Data strategy

- All fetches run in the Server Component (`page.tsx`) via `Promise.allSettled` so one failed fetch cannot blank the page.
- Each card component is a pure Server Component receiving typed props — no client-side data fetching.
- Client Components exist only where DOM interaction is required: timer clock tick, checkbox mutation, to-do add form.

## No database migrations (AS-005)

- QA-return signal derived from `task_activity` log (existing table) — no new columns.
- Workload capacity hardcoded to 40h for v1 — no `weekly_capacity` column needed.
- Unassigned count via SQL in `lib/queries/dashboard.ts` — no new RPC.

## New query additions (lib/queries/)

| File | New function | Purpose |
|---|---|---|
| `dashboard.ts` | `getUnassignedCount(workspaceId)` | Incomplete, unassigned tasks across workspace |
| `dashboard.ts` | `getKpiDelta(workspaceId, kind, daysBack)` | Overdue/completed count for any lookback window |
| `my-tasks.ts` | `getQaReturns(workspaceId, userId)` | Task activity transitions: QA → non-done within 7d |
| `projects.ts` | `getMyProjectsProgress(workspaceId, userId)` | done/total + overdue per project for current user |

## New component files (components/dashboard/)

| File | Role | Client? |
|---|---|---|
| `home-greeting.tsx` | Greeting header | No |
| `needs-you-card.tsx` | Attention items list | No (actions via link) |
| `my-work-card.tsx` | My tasks by group | Yes (checkbox mutation) |
| `today-time-card.tsx` | Timer + day total | Yes (interval tick, stop/start) |
| `coming-up-card.tsx` | Calendar blocks | No |
| `my-projects-grid.tsx` | Project progress cards | No |
| `team-health-section.tsx` | Owner/admin KPIs + workload | No |
| `workload-card.tsx` | Member bars | No |
| `home-skeleton.tsx` | Full-page skeleton | No |

## page.tsx changes

Replace body of `app/(workspace)/w/[workspaceSlug]/page.tsx`:
- Remove: `getPriorityCounts`, `getStatusCounts`, `DashboardContent`, `DashboardTaskTable` imports
- Add: `Promise.allSettled` over all new queries
- Role check: pass `role` from `getWorkspaceContext` to gate Team Health

## Deletion list (M5)

- `components/dashboard/priority-bar-chart.tsx`
- `components/dashboard/status-pie-chart.tsx`
- `components/dashboard/dashboard-task-table.tsx`
- `components/dashboard/dashboard-content.tsx`
- `components/dashboard/dashboard-content-lazy.tsx`
- `components/dashboard/dashboard-skeleton.tsx` (replaced by `home-skeleton.tsx`)
- Associated tests for deleted components
- Imports of deleted components from page.tsx (removed in M5 after new page is wired)

## Supabase MCP

No migrations → `mcp__supabase__apply_migration` not needed. Workers may use `mcp__supabase__execute_sql` for spot checks if needed but is not required.
