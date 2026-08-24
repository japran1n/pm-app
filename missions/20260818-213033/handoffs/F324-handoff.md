# Handoff: F324 — make the M16 Calendar and Timeline views reachable from the sidebar

## Status
COMPLETE

## Assertions covered
No assertion IDs assigned to this feature (per the spec: "No new assertion. This closes a gap the orchestrator found while reviewing F237.").

## Files changed
components/nav/app-sidebar.tsx
tests/unit/app-sidebar-calendar-timeline-nav.test.tsx

## Commands run
`npx tsc --noEmit` (0) — no output, 0 errors
`npx eslint .` (0) — "2 problems (0 errors, 2 warnings)"; both warnings are pre-existing, in files I did not touch (lib/queries/search.ts:280, tests/unit/invite-member-pagination.test.ts:186)
`npx vitest run tests/unit/app-sidebar-calendar-timeline-nav.test.tsx tests/unit/app-sidebar-trash-nav.test.tsx tests/unit/app-sidebar-archive-nav.test.tsx tests/unit/app-sidebar-settings-nav.test.tsx` (0) — "Test Files 4 passed (4)", "Tests 12 passed (12)"
`npx vitest run tests/unit` (1, but only due to a pre-existing unrelated failure) — "Test Files 1 failed | 125 passed (126)", "Tests 2 failed | 988 passed (990)". The failure is in tests/unit/user-avatar.test.tsx, caused by `cookies` being called outside a request scope inside lib/actions/comments.ts's getMentionCandidates (via components/task/comment-list.tsx) — nothing to do with the sidebar. Verified pre-existing: `git stash` (removing my change) then `npx vitest run tests/unit/user-avatar.test.tsx` alone still throws the same "Unhandled Rejection" (`cookies` was called outside a request scope, E251) even though that isolated run reports "10 passed (10)" — it's a flaky/environment issue in that file's own suite unrelated to app-sidebar.tsx, present on main before my change and not touched by my diff.

## Decisions made
- **Both "Calendar" and "Timeline" nav items are ungated (visible to guests, members, and admins alike)**, matching Dashboard/My Tasks/Projects/Search — not the guest-gated pattern used for Members/Archive/Templates/Trash. Justification: I read both `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` and `.../timeline/page.tsx` in full. Neither page contains a `role === "guest"` redirect guard (unlike, e.g., the archive/templates/trash pages, which the sidebar file's own comments cite as the reason those links are guest-gated). Both pages' own doc comments explicitly state they mirror the My Tasks page's structure ("exactly like the My Tasks page ... this page mirrors the structure of" for calendar; "exactly like the calendar page ... this page mirrors the structure of" for timeline) and rely on RLS-scoped queries (`getCalendarTasks`, `getTimelineTasks`) for private-project visibility enforcement, not a guest role check. Since My Tasks is ungated in the sidebar, Calendar and Timeline should be too — a guest who can see their own tasks should be able to see them on a calendar/timeline as well.
- **Active-state matching uses prefix matching (no `exact: true`)** for both entries, same as My Tasks/Projects/Search/Time/Members/Archive/Templates/Trash (only Dashboard and Settings use `exact: true`, because `/w/[slug]` is itself a prefix of every other route and `/w/[slug]/settings` is a prefix of `/w/[slug]/settings/profile` and `/w/[slug]/settings/members`). Calendar and Timeline have no known sub-routes, but the file's own convention is "default to prefix matching unless the href is itself a prefix of another distinct nav entry's href" — neither `/calendar` nor `/timeline` is a prefix of another entry, so this is consistent with, e.g., Archive/Trash/Templates which also have no sub-routes and still use prefix (not `exact`) matching.
- **Placement**: inserted directly after "Projects" and before "Search", per the spec's instruction that these are "workspace-wide views like My Tasks and Search, not project-scoped" — grouping the daily-driver/workspace-wide views (Dashboard, My Tasks, Projects, Calendar, Timeline, Search, Time) together ahead of the admin-ish/management group (Members, Archive, Templates, Trash, Settings).
- **Icons**: `CalendarDays` for Calendar and `GanttChartSquare` for Timeline, both already available in the `lucide-react` version already in use (verified via `node -e "require('lucide-react')"` — both exports exist), consistent in visual weight with the existing outlined-icon set (`LayoutDashboard`, `KanbanSquare`, `Search`, `Clock`, etc.).

## Out-of-scope work needed
None identified beyond what F324's own scope covers. Did not touch the calendar/timeline pages, their queries, or components, per the spec's scope discipline instruction.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose "ungated for guests" for both Calendar and Timeline nav entries, since neither underlying page has a guest-role redirect guard (confirmed by reading both page.tsx files in full and grepping for `role === "guest"` — no match), unlike the four entries (Members/Archive/Templates/Trash) that are guest-gated in the sidebar specifically because their pages have that redirect. This is the "check what the file actually does for comparable entries rather than assuming" instruction from the spec, applied to the actual page source rather than assumption.
AUTONOMOUS_DECISION: Used prefix (non-`exact`) matching for both new entries, following the file's established default (`exact` is reserved for hrefs that are themselves prefixes of other distinct entries' hrefs — Dashboard and Settings only).

## Notes for the next worker
- The previous session's work (sidebar edit + test file) was already committed as `3861ac4` before an API error cut off the run mid-handoff-writing. This session only re-verified the same commit's correctness (tsc/eslint/tests) and wrote/committed this handoff — no code changes were made in this session.
- If a future worker adds sub-routes under `/calendar` or `/timeline` (e.g. a detail view), re-check whether prefix matching still gives the desired active-state highlight; no change needed today since no sub-routes exist.
- No MCP usage was needed for this feature — pure client-side navigation component change, no external service state involved.
