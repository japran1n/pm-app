# Handoff: F208 — notification bell and panel

## Status
COMPLETE

## Assertions covered
AS-379: PASS — unit test `test_AS_379_bell_shows_the_unread_count` / `test_AS_379_negative_no_badge_is_shown_when_the_unread_count_is_zero` in tests/unit/notification-bell-panel.test.tsx.
AS-385: PASS — unit test `test_AS_385_lists_notifications_newest_first_with_actor_action_and_task` / `test_AS_385_negative_an_empty_notification_list_renders_the_empty_state_not_a_blank_area`.
AS-386: PASS — unit tests `test_AS_386_clicking_an_unread_notification_marks_it_read_and_updates_the_unread_count` / `test_AS_386_negative_...reverts...` plus integration tests `test_AS_386_markNotificationRead_marks_the_callers_own_notification_read` / `test_AS_386_negative_markNotificationRead_cannot_mark_someone_elses_notification_read` (tests/integration/notification-mark-read.test.ts, against the real Supabase project).
AS-387: PASS — unit tests `test_AS_387_mark_all_as_read_clears_the_unread_count` / `test_AS_387_negative_...` / `test_AS_387_the_mark_all_button_is_disabled_when_there_is_nothing_unread` plus integration tests `test_AS_387_markAllNotificationsRead_clears_every_unread_notification_for_the_caller_in_that_workspace` / `test_AS_387_negative_markAllNotificationsRead_does_not_touch_another_members_notifications`.

## Files changed
lib/queries/notifications.ts (new)
lib/actions/notifications.ts (new)
lib/validation/notifications.ts (new)
components/notifications/notification-bell.tsx (new)
components/notifications/notification-panel.tsx (new)
app/(workspace)/w/[workspaceSlug]/notifications/page.tsx (new)
app/(workspace)/w/[workspaceSlug]/layout.tsx (modified — fetches initial notifications/unread count, passes to AppSidebar)
components/nav/app-sidebar.tsx (modified — mounts <NotificationBell> in the workspace-switcher header row, desktop and mobile)
tests/unit/notification-bell-panel.test.tsx (new)
tests/integration/notification-mark-read.test.ts (new)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0, 2 pre-existing unrelated warnings)
`npx vitest run tests/unit/notification-bell-panel.test.tsx tests/integration/notification-mark-read.test.ts tests/integration/rls-notifications.test.ts` (0, 31/31 passed)
`npx vitest run tests/unit/app-sidebar-trash-nav.test.tsx tests/unit/app-sidebar-archive-nav.test.tsx tests/unit/app-sidebar-settings-nav.test.tsx` (0, unaffected by sidebar edit)
`npm run test` (full suite; 2 pre-existing integration files — workspace-members-list.test.ts, workspace-role-expansion.test.ts — fail/timeout against the live Supabase project both with and without my changes, confirmed by re-running on a clean `git stash`; unrelated to F208, no notification test in the failure list)

## Decisions made
- Notifications are scoped to the ACTIVE workspace (workspace_id filter), not merged across every workspace the caller belongs to — matches every other sidebar-fed query in this codebase (getWorkspaceMembers, project lists, etc.) and there's no cross-workspace inbox UI anywhere else to justify inventing one. Recorded per the clarified "simpler option, no new dependency, no second source of truth" ambiguity-resolution answer.
- No new RPC for mark-read: F206's `notifications_update_own` RLS policy already allows a signed-in user to UPDATE `read_at` on their own row, so both Server Actions do a plain client-session `.update()`, mirroring lib/actions/watchers.ts/comment-reactions.ts's self-serve-via-own-session convention. Verified via the integration test suite directly against the real project (no MCP needed at run — registry marks this feature "MCP at run: none").
- AS-385's "action" text is derived purely from `kind` (mention/comment_reply/task_assigned/task_due_soon/watcher_update) — F207's fan-out call sites all pass an empty `payload: {}`, so there is no free-text description anywhere in the row to render; a switch over the closed `kind` vocabulary is the one source of truth for the sentence, not a second copy of "what happened" text.
- AS-386 "clicking navigates to the item": there is no existing deep-link route that opens a specific task's detail sheet from a bare URL — board/list pages hold the open task in client-only state (`components/board/board.tsx`'s `onCardClick`), never a URL search param, and wiring that up would touch board/list page internals outside this feature's Files list. Clicking a notification with a resolvable task key navigates to `/w/{slug}/search?q={taskKey}` (the closest existing reachable "item" surface) and marks it read; a notification with no resolvable task (deleted task, or no task at all) still marks read via a plain button, just navigates nowhere. AUTONOMOUS_DECISION: took the simpler existing-route option per the clarified ambiguity-resolution default rather than adding new deep-link plumbing not asked for by this feature's file list.
- Soft-deleted tasks: a notification whose task has `deleted_at` set still shows up (the notification is real history for its owner) but renders "a deleted task" instead of the real title, and gets no navigable link — the simpler option (keep the row, degrade the label) over hiding the notification entirely or adding a restore-aware link.
- No new EmptyState shared component: this codebase has no single shared `EmptyState` primitive (BoardEmptyState/ListViewEmptyState/DashboardEmptyState/CommentList's "no comments" block are each their own small bespoke block) — the panel's empty state follows that same existing convention rather than introducing a new shared component this feature wasn't asked to build.
- Bell placement: mounted in `components/nav/app-sidebar.tsx`'s workspace-switcher header row (both the desktop `<aside>` and the mobile top bar) since this app has no real top bar yet — this feature's own Notes flagged that gap and told me to put the bell wherever it's reasonably reachable today, explicitly not to build F267's header. `app/(workspace)/w/[workspaceSlug]/layout.tsx` now fetches the initial notification list + unread count once (same pattern as `currentUser`/`workspaces`) and passes it down.

## Out-of-scope work needed
- A real deep-link route to open a specific task's detail sheet from a bare URL (e.g. `?taskId=` read by board/list pages) would let AS-386 navigate straight to the task instead of to a pre-filled search page — flagged above, not built here since it touches board/list page internals outside this feature's Files list. A future feature could add this and this feature's `taskHref` helper (components/notifications/notification-panel.tsx) would then be updated to point at it instead.
- F267 (real top bar / header search) still coordinates with this feature per the spec's own Notes — once that lands, the bell mount point in app-sidebar.tsx should move into the new header rather than staying in the sidebar's switcher row.
- No Realtime wiring for the bell/panel in this feature (F209's own scope per the migration's realtime-publication comment) — the badge/list only refresh on next page load or popover open, not live as new notifications arrive.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: AS-386 navigates to the workspace search page pre-filled with the task's key rather than a real task deep-link, since no deep-link route exists and adding one is out of this feature's file scope — see Decisions made above.
AUTONOMOUS_DECISION: notifications are workspace-scoped (active workspace only), not a cross-workspace merged inbox — see Decisions made above.

## Notes for the next worker
- `lib/queries/notifications.ts`'s `getNotificationsForWorkspace` is the one place actor/task display fields are resolved (batched, no N+1) — reuse it rather than re-querying `notifications` directly from a future feature.
- The integration test (`tests/integration/notification-mark-read.test.ts`) mocks `@/lib/supabase/server`'s `createClient` to return a real signed-in session client, same pattern worth reusing for any future Server-Action-level (not just raw-table) RLS test.
- Two integration test files (`workspace-members-list.test.ts`, `workspace-role-expansion.test.ts`) are flaky/slow against the live Supabase project independent of this feature — confirmed by running them on a clean stash of my changes; do not treat their failures as caused by F208.
- MCP: none used at run (registry says "MCP at run: none" for this feature); all verification was via the real Supabase project through the existing test-credential pattern (`.env`'s `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SECRET_KEY`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`), same as F206/F207's own integration tests.
