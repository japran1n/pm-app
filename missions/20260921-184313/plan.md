# Plan — Home Dashboard Redesign

_Mission: 20260921-184313_ _Written: 2026-09-21_

15 features across 5 milestones. Target per P-11: 15–45 min of worker time each.

**Gate at every milestone:** `npx tsc --noEmit`, `npx eslint . --max-warnings=0`, `npx vitest run tests/unit`, `npm run migrations:check`.

---

## M0 — Baseline

| # | Feature | Assertions |
|---|---|---|
| F001 [CLARIFIED-AUTO] [COMPLETE] | Record HEAD state: tsc, eslint, vitest, migrations:check → run-log | — |

## M1 — New data layer

Pure additions to query files. No UI, no component changes. Workers can run in parallel after F001.

| # | Feature | Assertions |
|---|---|---|
| F002 [CLARIFIED-AUTO] [COMPLETE] | `getUnassignedCount(workspaceId)` + `getKpiDelta(workspaceId, kind, daysBack)` in `lib/queries/dashboard.ts`; unit tests | AS-073, AS-074, AS-075 |
| F003 [CLARIFIED-AUTO] [COMPLETE] | `getQaReturns(workspaceId, userId)` in `lib/queries/my-tasks.ts` (task_activity transitions QA→non-done, last 7d, assigned to user); unit test with fixture | AS-023 |
| F004 [CLARIFIED-AUTO] [COMPLETE] | `getMyProjectsProgress(workspaceId, userId)` in `lib/queries/projects.ts` (done/total + overdue per member project); unit test | AS-050, AS-051, AS-052 |

## M2 — Personal cards (server components)

New component files under `components/dashboard/`. No page.tsx wiring yet — components are importable but not mounted on the live route. Each card receives typed props and has its own empty state.

| # | Feature | Assertions |
|---|---|---|
| F005 [CLARIFIED-AUTO] [COMPLETE] | `home-greeting.tsx` — name, date in user TZ, summary sentence (attention count, today count, overdue count) | AS-010, AS-011, AS-012 |
| F006 [CLARIFIED-AUTO] [COMPLETE] | `needs-you-card.tsx` — merged list (approvals + client requests + mentions + QA returns), capped at 10, action button per item type, empty state, client requests hidden from member role | AS-020, AS-021, AS-022, AS-023, AS-024, AS-025, AS-026 |
| F007 [CLARIFIED-AUTO] [COMPLETE] | `my-work-card.tsx` (client component) — overdue/today/this-week groups, max 8 rows, read-only status badge, checkbox calls existing status mutation, empty state | AS-030, AS-031, AS-032, AS-033, AS-034, AS-035, AS-036 |
| F008 [CLARIFIED-AUTO] [COMPLETE] | `today-time-card.tsx` (client component) — daily total formatted, active timer display with live clock, Stop/Resume via existing startTimeEntry/stopTimeEntry actions, empty state | AS-040, AS-041, AS-042, AS-043 |
| F009 [CLARIFIED-AUTO] [COMPLETE] | `coming-up-card.tsx` — next ≤3 calendar blocks for current user, time + title, empty state | AS-060, AS-061 |

## M3 — Projects + Team Health (server components)

| # | Feature | Assertions |
|---|---|---|
| F010 [CLARIFIED-AUTO] [COMPLETE] | `my-projects-grid.tsx` — progress bar (done/total), overdue count (red), project name, empty state | AS-050, AS-051, AS-052, AS-053 |
| F011 [CLARIFIED-AUTO] [COMPLETE] | `team-health-section.tsx` — KPI tiles (overdue+delta, unassigned, completed+delta) as links; `workload-card.tsx` — member bars vs 40h, over-capacity red; both hidden from member role | AS-070, AS-071, AS-072, AS-073, AS-074, AS-075, AS-076, AS-080, AS-081 |

## M4 — Wire into page.tsx + responsive

Replace `app/(workspace)/w/[workspaceSlug]/page.tsx` body. All queries via `Promise.allSettled`. Two-column layout (left/right) collapsing to single column ≤1100px.

| # | Feature | Assertions |
|---|---|---|
| F012 [CLARIFIED-AUTO] [COMPLETE] | `home-skeleton.tsx` — per-section skeleton matching card heights; used as page loading.tsx fallback | AS-110 |
| F013 [CLARIFIED-AUTO] [COMPLETE] | Wire `page.tsx`: parallel fetches via Promise.allSettled; pass settled results to each card; role gate for Team Health; layout: two-column ≥1100px, single-column below; responsive phone ≤560px | AS-010–AS-081, AS-100, AS-101, AS-110 |

## M5 — Remove old code + gate verification

| # | Feature | Assertions |
|---|---|---|
| F014 [CLARIFIED-AUTO] [COMPLETE] | Delete: priority-bar-chart.tsx, status-pie-chart.tsx, dashboard-task-table.tsx, dashboard-content.tsx, dashboard-content-lazy.tsx, old dashboard-skeleton.tsx; update/delete their unit tests; remove now-orphan imports; tsc clean | AS-090, AS-091, AS-092, AS-093, AS-094 |
| F015 [CLARIFIED-AUTO] [COMPLETE] | Final gate: tsc=0, eslint=0, vitest same baseline, migrations:check=0; record in run-log | AS-111, AS-112, AS-113 |
