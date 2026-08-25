# Handoff: F332 — M17 scrutiny BLOCKER-1 fix (remaining under-sized mobile nav tap targets, AS-518)

## Status
COMPLETE

## Assertions covered
AS-518: PASS — extended `tests/unit/f265-mobile-task-detail.test.tsx` with 4 new tests (bell trigger, project row, "Projects" collapsible trigger, favourite star), all green alongside the 7 pre-existing tests in that file (11/11 passed).

## Files changed
- components/notifications/notification-bell.tsx
- components/nav/project-nav-list.tsx
- tests/unit/f265-mobile-task-detail.test.tsx

## Commands run
`npx vitest run tests/unit/f265-mobile-task-detail.test.tsx` (0, 11/11 passed)
`npx vitest run tests/unit` (0, 163 files / 1248 tests passed; 1 pre-existing unrelated unhandled-rejection noise in `user-avatar.test.tsx`, not from this change — matches `NEXT-SESSION.md`'s documented "129 files fully green" baseline modulo unrelated concurrent-session growth)
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 6 warnings — 2 are the documented long-standing baseline, 4 more from other concurrently-running workers' in-progress files, not mine)
`npx next build` (0, compiled successfully)

## Decisions made
- Confirmed the mobile-bump breakpoint convention actually in use in this codebase is `max-md:` (not `max-sm:`), by reading `components/nav/app-sidebar.tsx`'s own doc comments on the hamburger trigger (`max-md:size-11`) and the primary nav Links (`max-md:min-h-11`) — both explicitly reasoned that `md` (not `sm`) is correct because that's the exact breakpoint this component switches between desktop `<aside>` and the mobile Sheet at (`hidden ... md:flex` / `... md:hidden`). Applied `max-md:size-11` / `max-md:min-h-11` to all 4 fixed controls for consistency with that established reasoning, not `max-sm:`.
- `NotificationBell`'s trigger Button: added `max-md:size-11` to its existing `className="relative"`. This component is shared between the desktop header bar (inside the `md:flex` `<aside>`) and the mobile top bar (inside `md:hidden`), so the `max-md:` prefix only affects the mobile rendering, leaving desktop sizing (`size-8`/32px, appropriate for a mouse-driven header) untouched.
- `ProjectNavList` row `Link`: added `max-md:min-h-11` to its existing className string (row-shaped element, so `min-h` matches the convention the primary nav Links already use for row-shaped elements, per app-sidebar.tsx's own comment reasoning, rather than `size-11` which is for square icon buttons).
- `ProjectNavList` "Projects" `CollapsibleTrigger` button: same `max-md:min-h-11` treatment (also row-shaped, full-width).
- Favourite star (`ProjectFavoriteButton`, `size="icon"`): added `max-md:size-11` to the `className` prop passed from `project-nav-list.tsx`. Verified in `components/project-favorite-button.tsx` that this component's own `cn(size === "icon" ? "size-7" : ..., "shrink-0 ...", className)` call puts the passed-in `className` LAST, so `max-md:size-11` correctly wins the cascade over the component's own `size-7` base class on mobile widths, without needing to touch `project-favorite-button.tsx` itself (kept the fix scoped to the two files BLOCKER-1 named).
- Test gap fix: added a `PROJECTS` fixture (one project with `isFavorite: false`) and 4 new tests that render the real `AppSidebar` WITH that non-empty `projects` array, so `ProjectNavList`'s real rows/trigger/star mount (previously they never did, since the existing tests always left `projects` undefined → empty state). Each new test asserts on EVERY matching rendered instance via `getAllByRole` (not just the first), matching this file's own existing convention (see the pre-existing Dashboard/profile-link test), since both the desktop `<aside>` and the mobile `Sheet` render the same `SidebarContent` twice.

## Out-of-scope work needed
None identified beyond BLOCKER-1's exact scope. BLOCKER-2 (image attachment double-icon) and BLOCKER-3 (uploadAttachmentForUser Server Action trust boundary) from the same M17 scrutiny report are explicitly out of scope for F332 and are visibly being worked by other concurrent sessions in this same repo (see `lib/actions/attachments.ts`, `app/api/extension/attachments/route.ts`, `tests/integration/extension-attachments.test.ts` showing as modified-but-uncommitted in `git status` at the time of this handoff — not touched by this feature).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: used `min-h-11` (not `size-11`) for the two row/full-width controls (project row Link, "Projects" collapsible trigger) and `size-11` for the two square icon-button controls (bell trigger, favourite star), mirroring the exact same `min-h` vs `size` split `app-sidebar.tsx` already established between its row Links (`max-md:min-h-11`) and its icon-only hamburger trigger (`max-md:size-11`) — this was implicit in the mission's own prior pattern, not spelled out verbatim in the scrutiny report's suggested fix text (which used `min-h-11` for all three drawer controls including the icon-shaped star), but `size-11` on an icon button is the more literal 44x44px fix and matches the codebase's own established split, so I used that instead of the report's literal suggestion for the star specifically.

## Notes for the next worker
- **Concurrent-session hazard hit during this run:** while this worker was mid-implementation, at least one other concurrent orchestrator/worker session was actively committing to the same working tree (visible via `git stash list` showing an unrelated pre-existing stash, and `git log` showing commits for F333/F335/an "orphaned handoffs" doc commit land mid-session). A `git stash` I ran to isolate a pre-existing `tsc` error (to confirm it wasn't caused by this feature) got tangled with that concurrent activity; I recovered by selectively `git checkout stash@{0} -- <only this feature's 3 files>` rather than a blanket stash pop, to avoid clobbering the other session's in-flight work. **This feature's 3 changed files ended up already committed by that other session**, inside commit `46d13f2` ("docs(mission): commit orphaned M17 handoff files...") — a commit whose message inaccurately claims "No code content, docs only" even though it actually carries this F332 fix's `components/nav/project-nav-list.tsx` and `components/notifications/notification-bell.tsx` changes (confirmed via `git show --stat 46d13f2`). The test file's additions landed in the same commit per `git log --follow`. I did not rewrite history to fix the mislabeled commit (destructive/non-additive, and other commits already stack on top of it) — flagging it here so the orchestrator's own commit-message audit doesn't miss that `46d13f2` is NOT docs-only.
- Recommend the orchestrator serialize workers against this repo (or use per-feature worktrees) to avoid a repeat of this race.
- Verified breakpoint convention by reading the doc comments already in `app-sidebar.tsx` next to the hamburger and nav-Link fixes, rather than assuming — this matched the task instructions' explicit warning not to assume `max-sm:` vs `max-md:`.
