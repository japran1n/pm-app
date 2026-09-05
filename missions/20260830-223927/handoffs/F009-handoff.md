# Handoff: F009 — Calendar realtime subscription

## Status
COMPLETE

## Assertions covered
AS-019: PASS — unit test "moves a task to its new date bucket when UPDATE changes due_date" (tests/unit/f009-calendar-realtime-subscription.test.ts)
AS-020: PASS — unit test "appends a new task with a due_date on INSERT (AS-020)"
AS-021: PASS — unit tests "removes a task from the calendar when UPDATE clears due_date" and "removes a task on DELETE (AS-021)"
AS-022: PASS — unit tests "ignores INSERT/UPDATE events for a project outside the caller's visible set (AS-022)" and "ignores a DELETE event for a project outside the caller's visible set (AS-022)"

## Files changed
components/calendar/use-calendar-realtime.ts (new)
lib/tasks/subscribe-calendar-realtime.ts (new)
lib/calendar/reconcile-realtime-task.ts (new)
tests/unit/f009-calendar-realtime-subscription.test.ts (new)
components/calendar/calendar-day-grid.tsx (wired hook + reconciler into existing `byDate` state)
components/calendar/month-grid.tsx (threaded `workspaceId`/`projectIds` props through to CalendarDayGrid)
app/(workspace)/w/[workspaceSlug]/calendar/page.tsx (passes `workspace.id` and `projects.map(p => p.id)` down)

## Commands run
`npx vitest run tests/unit/f009-calendar-realtime-subscription.test.ts` (0, 14/14 passed)
`npx tsc --noEmit` (0)
`npm run lint` (0 errors, 13 pre-existing warnings unrelated to this feature)
`npx vitest run` (0 — 104 test files fail workspace-wide with `@supabase/ssr: Your project's URL and API key are required` because `NEXT_PUBLIC_SUPABASE_URL` isn't set in this shell's test env; confirmed pre-existing via `git stash` + re-running one of the same failing files against `main` before my change — same failure, same file, nothing to do with F009)
`npx vitest run tests/unit/calendar-month-grid.test.ts tests/unit/f233-calendar-day-overflow.test.tsx tests/unit/f234-calendar-day-grid-wiring.test.ts tests/unit/f326-calendar-day-grid-rerender.test.tsx tests/unit/f235-calendar-responsive-render.test.tsx tests/unit/f235-calendar-resolve-filters.test.ts tests/unit/f234-calendar-reschedule-plan.test.ts tests/unit/f009-calendar-realtime-subscription.test.ts tests/integration/f234-calendar-drag-reschedule.test.ts tests/integration/f233-calendar-task-interactions.test.ts tests/integration/f235-calendar-filters.test.ts tests/integration/f232-calendar-query.test.ts` (0 — every calendar-related file passes; the only 2 failing suites, F232/F235 integration tests, fail on `Request rate limit reached` signing into the real Supabase auth server, an environment/network issue unrelated to this feature's code)

## Decisions made
- Mirrored the board's realtime split exactly (F049): a plain, DOM-free `subscribeToCalendarRealtime` function (unit-testable without React) + a thin `useCalendarRealtime` hook that's just the `useEffect` lifecycle glue, both using `lib/realtime/shared-topic-channel.ts`'s ref-counted registry (F329) so a calendar tab and any other tab subscribed to the same topic never double-subscribe.
- Reconciliation logic lives in `lib/calendar/reconcile-realtime-task.ts` as a pure function (`reconcileCalendarRealtimeEvent`), called from `CalendarDayGrid`'s existing `byDate` `useState` — matches the clarified "callback-based; calendar component owns state" answer and mirrors `lib/board/reconcile-realtime-task.ts`'s "merge, don't replace" / best-effort-INSERT tradeoff for fields a bare `tasks` row event can't carry (`statusCategory`, `projectKey`, `projectName`, `assignees` default until the next reload).
- AUTONOMOUS_DECISION: The clarification's literal `postgres_changes` filter (`workspace_id = eq.{workspaceId}`) is not achievable — verified by reading `supabase/migrations/20260818013805_rls_tasks.sql`'s own comment and the `create_tasks` migration: the `tasks` table has no `workspace_id` column, only `project_id` (workspace is one join away, via `projects`). Realtime's `filter` syntax can only reference a literal column on the subscribed table. Subscribed with no `filter` instead (all `tasks` events, topic name `tasks:calendar:${workspaceId}` used only as a local dedup key), relying on: (1) RLS (`tasks_select_active_members`) for INSERT/UPDATE, which already gates every event the caller could receive to their own visible projects, exactly like the board's own subscription documents; and (2) a client-side `visibleProjectIds` set (the workspace's own project ids, threaded down from the page's already-fetched `projects` list) checked in `reconcileCalendarRealtimeEvent` before touching state, as the backstop for DELETE specifically — Realtime does NOT apply RLS to DELETE broadcasts (verified via `supabase/migrations/20260824050000_realtime_project_statuses_publication.sql`'s own doc comment on the identical gap for `project_statuses`), so without this check a DELETE for a task in a workspace/project the caller can't see could otherwise reach the client. This satisfies AS-022 for all three event types.
- Did NOT add a `replica identity full` migration for `tasks`: the chosen reconciler design (`removeTaskEverywhere` by id, then re-insert into the NEW date bucket from `event.new.due_date`) never needs `old_record.due_date` to detect a move, unlike the clarification's suggested "compare old vs new" approach — so the migration some earlier bare-PK-replica-identity callers needed (`project_statuses`, `comment_reactions`) isn't required here. `event.old.project_id` (used only as an extra DELETE-visibility check) may be `undefined` under the table's current (default) replica identity; the code treats an unset `project_id` on DELETE as "no known project to check" and still allows the removal (safe: `removeTaskEverywhere` is a no-op for a task id never present in local state, which is guaranteed for any task the caller never had RLS-visible access to add in the first place).
- Did not create `lib/tasks/reconcile-calendar-realtime-task.ts` (F010's own assigned file path) — F009 could not ship a working, testable calendar subscription without a reconciler, so I built one at `lib/calendar/reconcile-realtime-task.ts` and documented in its own header that F010 should treat it as already covering F010's scope rather than building a second, parallel implementation.

## Out-of-scope work needed
- `components/calendar/agenda-list.tsx` (the mobile `md:hidden` view) is a Server Component with no client state — it does not receive live updates from this feature. Out of this feature's declared "calendar page component" scope (that scope was interpreted as the day-grid client component that already owns realtime-updatable state, per the clarified "calendar component owns state" answer). A future feature could lift agenda-list into a small client wrapper mirroring calendar-day-grid.tsx if live-updating the mobile agenda view is wanted.
- F010 ("Calendar realtime — task reconciliation helper") — see Decisions above; its assigned assertions are already covered by this feature's `lib/calendar/reconcile-realtime-task.ts` and its own unit tests. Recommend either closing F010 as satisfied by F009, or having F010 do a pure rename/relocate + light refactor if the exact file path/export name in its spec matters to a downstream consumer.
- True end-to-end two-tab Realtime delivery (the DoD's "manual verification") was not exercised live (would require a live Supabase Realtime connection and two browser contexts) — same documented limitation `tests/unit/board-realtime-subscription.test.ts`'s own header comment calls out for the identical board feature; recommend a Playwright two-context test if e2e coverage for this exact flow is wanted later.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Subscribed to the calendar's Realtime channel with no Postgres `filter` (instead of the clarification's literal `workspace_id = eq.{workspaceId}`, which references a column `tasks` doesn't have) — see "Decisions made" above for the full verification and the RLS + client-side visible-project-id backstop that keeps AS-022 satisfied anyway.
AUTONOMOUS_DECISION: Threaded a new `projectIds: string[]` prop through `page.tsx` → `CalendarGridSection` → `MonthGrid` → `CalendarDayGrid` (derived from the page's existing `getWorkspaceProjects` read) specifically to give the client-side DELETE-visibility backstop something real to check against, since it's not derivable from `tasksByDate` alone (a workspace with zero currently-due tasks would otherwise have an empty, always-false visibility set).

## Notes for the next worker
- Pattern to follow for the next realtime feature (e.g. F011, My Tasks realtime): `lib/board/subscribe-board-realtime.ts` + `components/board/use-board-realtime.ts` is the canonical minimal pair; this feature's `lib/tasks/subscribe-calendar-realtime.ts` + `components/calendar/use-calendar-realtime.ts` is the closest analog for a table that has no single-column row filter available.
- `lib/realtime/shared-topic-channel.ts`'s own header comment is essential reading before touching any realtime hook in this repo — it documents a real StrictMode double-mount crash and the ref-counted/deferred-teardown fix every `subscribe*Realtime` module here depends on.
- No MCP tools were used for this feature (registry note: "MCP at run: none" for F009); schema facts (no `workspace_id` column on `tasks`, no `REPLICA IDENTITY FULL` on `tasks`) were verified by reading the actual migration files in `supabase/migrations/`, not assumed.
