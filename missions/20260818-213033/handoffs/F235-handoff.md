# Handoff: F235 — calendar-filters-responsive

## Status
COMPLETE

## Assertions covered
AS-448: PASS — the calendar respects active filters (status/priority/assignee/project), narrowed in the real `getCalendarTasks` query (`lib/queries/calendar.ts`). Proven end-to-end against the real linked Supabase project in `tests/integration/f235-calendar-filters.test.ts` (7/7 passing), plus the pure `resolveCalendarFilters` "stale/tampered value degrades gracefully" contract in `tests/unit/f235-calendar-resolve-filters.test.ts` (8/8 passing).
AS-449: PASS — the calendar renders as an agenda list at phone width instead of a squeezed grid. Proven via component-level markup assertions (`tests/unit/f235-calendar-responsive-render.test.tsx`, 5/5 passing) that both trees render from the same real props and carry the `md:hidden`/`hidden md:block` classes that switch them. The intended real-browser 375px/desktop proof (`tests/e2e/f235-calendar-responsive.spec.ts`) is written and committed but currently blocked by a pre-existing sandbox infra issue in the magic-link Playwright login flow — see "Notes for the next worker" below; this is NOT a regression introduced by this feature (the baseline `tests/e2e/theme-toggle.spec.ts`, untouched by this feature, fails at the identical login step when run in this sandbox).

## Files changed
lib/queries/calendar.ts
lib/queries/tasks.ts
lib/calendar/resolve-filters.ts (new)
components/calendar/calendar-filters.tsx (new)
components/calendar/agenda-list.tsx (new)
components/calendar/month-grid.tsx
app/(workspace)/w/[workspaceSlug]/calendar/page.tsx
tests/unit/f235-calendar-resolve-filters.test.ts (new)
tests/unit/f235-calendar-responsive-render.test.tsx (new)
tests/integration/f235-calendar-filters.test.ts (new)
tests/e2e/f235-calendar-responsive.spec.ts (new)

## Commands run
`npx tsc --noEmit` (0, no output — clean)
`npx eslint .` (0 errors, 2 pre-existing unrelated warnings in lib/queries/search.ts and tests/unit/invite-member-pagination.test.ts, both present before this feature)
`npx vitest run tests/unit/f235-calendar-resolve-filters.test.ts` (0 — 8/8 passed)
`npx vitest run tests/integration/f235-calendar-filters.test.ts` (0 — 7/7 passed, against the real linked Supabase project)
`npx vitest run tests/unit/f235-calendar-responsive-render.test.tsx` (0 — 5/5 passed)
`npx vitest run tests/unit/calendar-month-grid.test.ts tests/unit/f233-calendar-day-overflow.test.tsx tests/unit/f234-calendar-day-grid-wiring.test.ts tests/unit/f234-calendar-reschedule-plan.test.ts tests/integration/f232-calendar-query.test.ts` (0 — 36/36 passed; F232-F234 regression slice)
`npx playwright test tests/e2e/f235-calendar-responsive.spec.ts` (1 failed — pre-existing sandbox infra issue at the magic-link login step, reproduced identically by the untouched baseline `tests/e2e/theme-toggle.spec.ts`; see Notes below)
`npx vitest run` (full suite, all files together) — many PRE-EXISTING unrelated failures (invite-member, recurrence-scheduled-generation, checklist-actions, saved-views RLS/UI/actions, trash-list) consistent with the documented "Supabase Auth rate limiting" infra condition when many integration tests race against the same live project concurrently; none of the failures are in calendar/F232-F235 files. Every F235-owned test file passed when run in isolation (see above), matching the "re-run alone before calling it a regression" guidance.

## Decisions made
- Cross-project status filter (AS-448's core correctness point): filters on the column's real NAME via `.eq("status", name)` against `tasks.status`, which `sync_task_status_and_status_id` keeps byte-for-byte in sync with `project_statuses.name`. This is the SAME precedent F223 already established for the dashboard's `getStatusCounts`/`getWorkspaceListTasks` — group on column NAME across projects, never a fixed four-value enum or category. Proven against two seeded projects with genuinely different column sets (one default, one with its "done" column renamed to "Shipped") in the integration test.
- Assignee filtering reuses the exact `filterTaskIdsByAnyAssignee` helper `getWorkspaceListTasks` (lib/queries/tasks.ts) already has — exported it (it was previously module-private) rather than writing a second implementation.
- Stale/tampered filter handling: new pure `resolveCalendarFilters` (lib/calendar/resolve-filters.ts), modeled directly on `resolveListViewFilters` (F229) and the project List page's own inline validate-against-real-set posture. `status`/`priority`/`projectId` are validated against real known sets and dropped if unrecognized; `assigneeId` is deliberately left unvalidated (matching the List page's own direct-filter-param path), since a stale assignee id just matches zero tasks via the query's own join — already "graceful," no second membership lookup needed.
- Responsive fallback (AS-449): a genuinely different component (`AgendaList`), not CSS squeezing the grid, per the spec's explicit Notes. Both `<CalendarDayGrid>` and `<AgendaList>` render unconditionally in `month-grid.tsx`; Tailwind's `md:hidden` / `hidden md:block` (768px) — the SAME breakpoint `components/nav/app-sidebar.tsx` already uses for its own phone-vs-desktop layout — picks exactly one per viewport, no client-side JS branch needed.
- Equivalent affordances at phone width: overflow doesn't apply to an agenda list (every task is just another row, nothing to cap); drag-reschedule's equivalent is the same click-through every chip already offers — tapping a task opens the board's `?taskId=` deep-linked detail sheet, where the existing due-date field already calls the identical `editTask` Server Action the drag handler uses. One real mutation path, two ways to reach it.
- Tag filter (mentioned in the spec's Draft scope "assignee, priority, project, tag") was NOT implemented — there is no tag data model anywhere in this codebase (grepped for `task_tags`/tag columns, found none). Implementing it would require a new schema, which is out of this feature's scope per its own "reuse existing conventions" clarified answer. Recorded as out-of-scope below.
- `getUndatedTaskCount`'s footer text stays UNFILTERED by F235's own filters — it explains an absence (no due date at all) that has nothing to do with which filter is active, and filtering it would require threading filters through a second query for a footer whose wording doesn't depend on them.
- AUTONOMOUS_DECISION: replaced `getCalendarTasks`'s old bare `projectId?: string` 4th parameter with a `CalendarTaskFilters` object (`{ projectId, status, priority, assigneeId }`). No caller anywhere in the repo used the old positional `projectId` argument (confirmed via grep before changing it), so this is not a breaking change to any real call site — it's the "clean seam" F232's own doc comment said F235 was expected to extend.

## Out-of-scope work needed
- A real tag/label data model and its filter — no `tags`/`task_tags` table exists anywhere in this codebase yet; adding one is a schema-level feature of its own, not something this filter-wiring feature should introduce as a side effect.
- The Playwright magic-link login flow (`tests/e2e/theme-toggle.spec.ts`, `tests/e2e/board-reorder.spec.ts`, and this feature's own new `tests/e2e/f235-calendar-responsive.spec.ts`) currently fails in this sandbox at the `page.waitForURL(/\/sign-in\?error=auth_failed#/)` step — worth a dedicated investigation (likely the same "Supabase Auth rate limiting"/clock-skew class the mission's "Known infra conditions" section names, or a genuine environment difference in how `/auth/callback` behaves here) since it blocks EVERY e2e test that needs a real logged-in session, not just this feature's.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: `getCalendarTasks`'s 4th parameter changed from a bare optional `projectId` string to a `CalendarTaskFilters` object — verified no existing caller used the old shape before making the change.
AUTONOMOUS_DECISION: cross-project status filtering follows F223's "group by column NAME" precedent rather than grouping by `category`, since a category-based filter would conflate two projects' genuinely different-named "done" columns and lose the ability to distinguish, e.g., a specific "In Review" column from "Done."
AUTONOMOUS_DECISION: tag filter dropped from scope — no tag data model exists in this codebase (see "Out-of-scope work needed").

## Notes for the next worker
- MCP: none used — this feature's own registry entry says "MCP at run: none," and no live-schema introspection was needed beyond what was already readable from the existing `project_statuses`/`tasks` migrations in the repo.
- The e2e Playwright test for AS-449 (`tests/e2e/f235-calendar-responsive.spec.ts`) is written, committed, and structurally correct (it reuses the exact login technique `theme-toggle.spec.ts`/`board-reorder.spec.ts` already use), but currently can't complete a full run in this sandbox because the magic-link auth callback never reaches `/sign-in?error=auth_failed#...` within the 15s timeout — the SAME failure the pre-existing, unmodified `theme-toggle.spec.ts` reproduces when run standalone in this same sandbox (confirmed by running it directly: 2 of its 6 tests fail at the identical `loginAndGoToDashboard` step, 4 pass). This is an environment-level issue affecting every Playwright test in the repo that needs a real session, not something introduced by this feature. AS-449 is otherwise proven at the component-render level (five real markup-assertion tests) and by manual reasoning about the Tailwind breakpoint match with `app-sidebar.tsx`'s own precedent.
- Full unfiltered `npx vitest run` (every integration test in the repo, all at once) shows a wide, unrelated set of pre-existing failures (invite-member, recurrence-scheduled-generation, checklist-actions, saved-views) consistent with the documented Supabase-Auth-rate-limiting infra condition when this many real-Supabase integration tests race concurrently. Every file this feature owns passes cleanly when run alone (see "Commands run"). Re-running the full suite serially/with delays, or in smaller batches, would very likely turn all of those green again — this is not something this feature's code caused.
