# Handoff: F029 — switcher url wiring

## Status
COMPLETE

## Assertions covered
AS-011: PASS — `buildWeekNavHref` (lib/calendar/people-selection.ts) carries the raw `?people=` value forward untouched on prev/next/today nav hrefs; covered by tests/unit/f029-switcher-url-wiring.test.tsx.
AS-012: PASS — `PeopleSwitcherUrlBound`'s `onSelectionChange` pushes a URL that always includes the current `weekParam` when one was present; covered by the same test file (verified via a real render + click through `PeopleSwitcher`, not a re-implementation).
AS-013: PASS — no `localStorage`/`sessionStorage` API call anywhere in the switcher/wiring path; covered by a `Storage.prototype.setItem` spy during an actual selection change plus a source-scan test guarding against future regressions.
AS-059: PASS — deselecting the only selected member pushes `people=me` (self), never an empty/absent people value; covered in the same file.

## Files changed
- app/(workspace)/w/[workspaceSlug]/calendar/page.tsx
- components/calendar/week-view.tsx
- lib/calendar/people-selection.ts
- tests/unit/f029-switcher-url-wiring.test.tsx (new)

Note: components/calendar/people-switcher.tsx also carries this feature's `PeopleSwitcherUrlBound` export, but it landed in commit `1ab50a12` ("feat(F028): add Just me / whole team shortcuts...") because an F028 worker ran concurrently and committed the file after my edits were already on disk — the file's current HEAD content includes my F029 additions verbatim. My own commit (`43b6201d`) only touches the four files listed above, which were still diffed against HEAD at commit time.

## Commands run
`npx tsc --noEmit` (0)
`npx vitest run tests/unit/f029-switcher-url-wiring.test.tsx` (0, 9 passed)
`npx vitest run tests/unit/f029-switcher-url-wiring.test.tsx tests/unit/people-switcher.test.tsx tests/unit/calendar-week-only-view.test.tsx tests/unit/planner-people-selection.test.ts` (0, 55 passed)
`npx vitest run tests/unit` (133 pre-existing failures across ~41 files, none touching calendar/people-switcher/F029 code — same pre-existing-failure set other workers in this mission have already documented, e.g. F013's handoff; grepped the FAIL list and confirmed no `calendar`/`people-switcher`/`f029` entries)

## Decisions made
- Extracted `buildWeekNavHref({ workspaceSlug, weekKey?, peopleParam? })` into `lib/calendar/people-selection.ts` rather than leaving the href-building inline in the page component, so AS-011's "preserves ?people= verbatim" behaviour is independently unit-testable instead of only reachable through a full page render.
- `weekHrefFor`/`todayHref` now forward the *raw* `peopleParam` string (never re-parsed/re-serialized) — a stale-but-still-valid selection string round-trips exactly as given through week navigation, matching AS-011's "preserves the value" wording literally rather than normalizing it.
- `PeopleSwitcherUrlBound` (in `components/calendar/people-switcher.tsx`) is a thin client wrapper around the already-existing controlled `PeopleSwitcher` (built by a concurrent F026/F027 worker): it owns nothing but `router.push` on `onSelectionChange`, building the URL from `workspaceSlug` + `weekParam` (a plain string prop, not a function — Server→Client Component props must be serializable) + the new selection. Coerces an empty next-selection to `[selfId]` before it ever reaches `serializePeopleParam`/the URL (AS-059).
- Wired `PeopleSwitcherUrlBound` into `WeekView`'s header row behind an optional `peopleSwitcher` prop (default `undefined`) rather than making it required, so every existing `WeekView` test/caller that doesn't know about the switcher yet keeps behaving exactly as before (verified `calendar-week-only-view.test.tsx` still passes unchanged).
- Did NOT change `blockUserIds` in the calendar page — it still queries every active member's blocks regardless of the resolved `selectedUserIds`. Applying the selection to what's actually rendered is M7's job (F032 `StackedPlanner`, plan.md), not F029's "wire the switcher to the URL" scope. Logged below as out-of-scope.
- Used `router.push` (not `.replace`) to match the plain `<Link>`-driven prev/next/today navigation `week-view.tsx` already uses, so switcher changes are equally back/forward-navigable.

## Out-of-scope work needed
- The Planner still fetches every active member's blocks regardless of the resolved `?people=` selection (`blockUserIds={workspaceMembers.active.map(...)}` in page.tsx, unchanged). F031/F032 (M7, "the stacked layout") are the features that actually consume `selectedUserIds` to decide what's rendered — this feature only had to get the *URL* right, not the rendering.
- F030 ("Header placement alongside the week controls; reachable at mobile width; keyboard-operable") still needs to polish the switcher's placement in the header (it currently renders inline next to the other week-nav buttons, which is functional but not yet verified for mobile reachability or explicit keyboard-operability beyond what cmdk/Popover already provide out of the box).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Extracted `buildWeekNavHref` as a new exported pure function rather than leaving href construction inline in the page component (spec's "Files (approximate)" didn't mention `lib/calendar/people-selection.ts` or the calendar page, but the clarification file defers to "safest default that satisfies assertion text" — a testable pure function was the only way to get real (not re-implemented-in-the-test) coverage on AS-011 without an end-to-end/Playwright test, which wasn't specified as required here).
AUTONOMOUS_DECISION: Rendered `PeopleSwitcherUrlBound` inside `WeekView`'s existing header row (not a new dedicated header component) since some rendering location was required to make the wiring reachable/testable in the real app; F030 owns refining that placement, not introducing it from scratch.

## Notes for the next worker
- `components/calendar/people-switcher.tsx` was being actively edited by a concurrent F026/F027/F028 worker during this session — at the start of this task the file didn't exist at all, then appeared mid-session already containing the F026 shell + F027 multiselect, and by the time I committed, a separate F028 commit (`1ab50a12`) had already absorbed my `PeopleSwitcherUrlBound` addition into its own commit. If you're auditing history by commit, F029's actual `PeopleSwitcherUrlBound` code lives in that F028 commit, not `43b6201d`; the corresponding tests (`tests/unit/f029-switcher-url-wiring.test.tsx`) are in my own commit and exercise it via the real `@/components/calendar/people-switcher` import, so the coverage is genuine regardless of which commit the source lines physically landed in.
- `tests/unit/people-switcher.test.tsx` already has F028-authored tests for "Just me"/"Whole team" shortcuts (AS-056/AS-057) — not this feature's assertions, left untouched.
- No MCP tools were used — this feature is pure client/server routing logic with no external service or live schema to introspect.
