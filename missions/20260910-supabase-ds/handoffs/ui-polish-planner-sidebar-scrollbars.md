# Handoff: UI polish — Planner rename, sidebar project cleanup, scrollbars, calendar hover-plus

## Status
COMPLETE

## Assertions covered
This is an ad hoc UI-polish task, not tied to specific validation-contract assertion IDs. No AS-NNN IDs were assigned. Manually verified via `npm run build` and targeted `vitest` runs (see Commands run).

## Files changed
components/nav/app-sidebar.tsx
components/nav/project-nav-list.tsx
app/globals.css
components/calendar/week-time-grid.tsx
tests/unit/app-sidebar-calendar-timeline-nav.test.tsx
tests/unit/app-sidebar-project-nav-list.test.tsx
tests/unit/project-nav-list-icon.test.tsx
tests/unit/calendar-week-time-grid-create-popover.test.tsx

## Commands run
`npm run build` (0)
`npx vitest run tests/unit/calendar-week-time-grid-create-popover.test.tsx tests/unit/calendar-week-time-grid-live-resize.test.tsx` (0)
`npx vitest run tests/unit/project-nav-list-icon.test.tsx tests/unit/app-sidebar-project-nav-list.test.tsx tests/unit/app-sidebar-calendar-timeline-nav.test.tsx tests/unit/project-nav-dot-contrast.test.ts tests/unit/project-nav-list-sidebar-position.test.tsx tests/unit/project-favorites-sidebar-pin.test.tsx tests/integration/f234-calendar-drag-reschedule.test.ts tests/unit/f234-calendar-day-grid-wiring.test.ts tests/unit/f326-month-grid-datakey-wiring.test.tsx tests/unit/f326-calendar-day-grid-rerender.test.tsx tests/unit/app-sidebar-trash-nav.test.tsx tests/unit/app-sidebar-archive-nav.test.tsx tests/unit/calendar-week-only-view.test.tsx tests/unit/f235-calendar-responsive-render.test.tsx` (1 — 2 pre-existing failures in app-sidebar-project-nav-list.test.tsx unrelated to this change, see Notes below; confirmed via `git stash` that they fail identically on the pre-change tree)

## Decisions made
- **Change 1 (Calendar → Planner):** Only the sidebar nav label was renamed (`components/nav/app-sidebar.tsx`). The calendar page itself (`app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`) renders no visible "Calendar" heading/title anywhere — it only has a filters bar and the week grid — so there was nothing else to rename there. The route (`/w/[workspaceSlug]/calendar`) and every internal identifier (`CalendarPage`, `getCalendarTasks`, etc.) were intentionally left untouched — only the user-facing label changed.
- **Change 2 (sidebar project row):** Removed the icon/colour-dot/key-abbreviation block from `SortableProjectRow`'s `content` in `project-nav-list.tsx`, along with the now-dead `colorForProjectId`/`DOT_COLORS` helper and the unused `FolderKanban` icon import. Left `tests/unit/project-nav-dot-contrast.test.ts` in place (it's self-contained — checks a hardcoded Tailwind hex table for contrast, never imports the component — so it still passes harmlessly even though the dot it was guarding no longer renders); flagged as follow-up cleanup below.
- **Change 3 (scrollbars):** Added the webkit + standard `scrollbar-width`/`scrollbar-color` rules to the existing `@layer base` block in `app/globals.css`, using `oklch(from var(--foreground) l c h / …)` so the thumb color derives from the theme token and resolves correctly in both light and dark themes (per the Supabase DS token rules).
- **Change 4 (calendar hover-"+"):** The spec named `components/calendar/calendar-day-grid.tsx`, but that component (and its parent `month-grid.tsx`) is **dead code** — `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` only renders `WeekView`/`WeekTimeGrid` (month view was removed by an earlier product decision per that page's own header comment: "Week is the ONLY view"). The actual live "click anywhere creates a block immediately" behavior lives in `components/calendar/week-time-grid.tsx`'s `handleColumnPointerDown` (a plain zero-delta pointerdown/pointerup on the column already produced a block via `dragRangeToTimes`'s own minimum-width fallback). Implemented the hover-"+" UX there instead, since that's what a user actually sees:
  - Added `hoveredSlot` state tracking the currently-hovered half-hour slot (mouse-only, via `onMouseMove`/`onMouseLeave` on each day column — real drag-to-create for touch/stylus users is unaffected, no "+" needed there since they can't hover).
  - Removed `onPointerDown` from the day-column div itself, so a bare click/press anywhere on the grid no longer starts anything.
  - Added a small dashed "+"-with-time-label button (`calendar-week-add-slot-<date>` test id) that only renders at the hovered slot; its own `onPointerDown` is now the *only* thing that starts `handleColumnPointerDown` (the existing drag-to-create/resize machinery — `dragRangeToTimes`, pointer capture, live drag preview — is otherwise untouched, so a real press-and-drag starting from the "+" still produces a genuine pixel-derived time range exactly as before).
  - The "+" trigger deliberately stays mounted through an in-flight gesture on its own slot (guarded only by `resize`/`pendingCreate`, not `dragCreate`) — hiding it the instant `dragCreate` becomes non-null would unmount the very element pointer capture was just set on, breaking the pointerup that commits the gesture (caught by a first failing test run, see Notes).
  - Time label is computed via the same `pixelOffsetToTime` helper `dragRangeToTimes` already uses, so the label always matches what actually gets created.

## Out-of-scope work needed
- `tests/unit/project-nav-dot-contrast.test.ts` is now testing a UI affordance (the project nav dot) that no longer renders anywhere. It doesn't fail (it's a self-contained hex-table contrast check), but it's stale and should be deleted or repurposed in a follow-up cleanup pass.
- `components/calendar/calendar-day-grid.tsx`, `components/calendar/month-grid.tsx`, `components/calendar/day-cell.tsx`, `components/calendar/add-block-popover.tsx`, `components/calendar/agenda-list.tsx` and their dedicated tests (`f234-calendar-day-grid-wiring.test.ts`, `f326-month-grid-datakey-wiring.test.tsx`, `f326-calendar-day-grid-rerender.test.tsx`, `tests/integration/f234-calendar-drag-reschedule.test.ts`) all still exist and still pass, but appear to be dead code no longer reachable from any page (month view was removed by product decision per `calendar/page.tsx`'s own header comment, and only `WeekTimeGrid` is rendered live). Worth a dedicated cleanup feature to either delete this dead code or confirm it's intentionally kept as a fallback.
- The two pre-existing failures in `tests/unit/app-sidebar-project-nav-list.test.tsx` ("AS-509: passes the workspace's projects through" and "AS-513: an empty project list still renders the create action") are unrelated to this task — they fail because that specific test's `next/navigation` mock is missing `useRouter` (needed since `NotificationBell` calls it). Confirmed via `git stash` that they fail identically on the pre-change tree. Worth a follow-up to add `useRouter: () => ({...})` to that mock.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Implemented Change 4 (hover-"+" calendar UX) against `components/calendar/week-time-grid.tsx` instead of the spec-named `components/calendar/calendar-day-grid.tsx`, because the latter (and its parent `month-grid.tsx`) is dead code no longer rendered by any page — the calendar page only renders the week/time-grid view (month view was removed by an earlier, separate product decision). Applying the change to the actually-live component is what a user would observe; applying it only to the dead month-grid component would have produced zero visible effect.

## Notes for the next worker
- No MCP tools were used — this was a pure UI/CSS polish task with no external-service surface.
- First implementation attempt of Change 4 hid the "+" button the instant a drag started (`!dragCreate` in its render guard), which unmounted the element pointer capture had just been set on and broke the pointerup commit — caught immediately by the existing `calendar-week-time-grid-create-popover.test.tsx` test suite (rewritten for the new hover-"+" contract) after fixing the render guard to only depend on `resize`/`pendingCreate`, not `dragCreate`.
- `tests/unit/calendar-week-time-grid-create-popover.test.tsx` was rewritten (not just patched) since its previous name/doc-comment described the exact old behavior ("plain click creates a block") that this task explicitly asked to remove; the new version proves both halves of the new contract (bare click does nothing; hover + click on "+" does).
