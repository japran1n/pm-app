# Handoff: F304 — fix swallowed create_notification RPC errors + link mention notifications to comments

## Status
COMPLETE

## Assertions covered
AS-374: PASS — mention notifications now carry a resolvable `commentId` (already stored on the row by F207; now selected by the query and appended to the deep-link href), verified by tests/unit/notification-bell-panel.test.tsx's new commentId-link tests and the existing real-DB tests/integration/notification-fanout.test.ts assertion on `rows?.[0].comment_id`.
AS-386: PASS — the board's `?taskId=` deep-link now always opens the sheet (fetch-by-id via the existing `getTaskDetail` round trip inside `openTask`, regardless of whether the id is in the board's locally-loaded `tasks` array), verified by the new "task not in loaded array" test in tests/unit/board-taskid-deeplink.test.tsx; the create_notification RPC-error-observability fix (D2/FU-4) is verified by a real-Supabase integration test (tests/integration/notification-error-observability.test.ts) plus a fully mocked unit test (tests/unit/create-notification-error-observability.test.ts).

## Files changed
lib/notifications/create-notification.ts (new)
lib/notifications/mentions.ts
lib/actions/tasks.ts
lib/actions/comments.ts
lib/queries/notifications.ts
components/notifications/notification-panel.tsx
components/board/board.tsx
components/task/task-detail-sheet.tsx
components/task/comment-list.tsx
tests/unit/create-notification-error-observability.test.ts (new)
tests/integration/notification-error-observability.test.ts (new)
tests/unit/board-taskid-deeplink.test.tsx
tests/unit/notification-bell-panel.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 2 pre-existing unrelated warnings)
`npx vitest run tests/unit/create-notification-error-observability.test.ts tests/unit/notification-bell-panel.test.tsx tests/unit/board-taskid-deeplink.test.tsx tests/unit/notification-fanout.test.ts tests/integration/notification-fanout.test.ts tests/integration/notification-mark-read.test.ts tests/integration/notification-error-observability.test.ts` (0 — 38 passed, 4 skipped)
`npx vitest run` (full suite; 194 passed / 54 failed test files — all 54 failures are pre-existing and environment-caused: Supabase auth "Request rate limit reached" from running the whole integration suite back-to-back, one JWT-clock-skew flake, and one pre-existing missing-env-var failure in tests/unit/user-avatar.test.tsx unrelated to this feature — confirmed by `git stash` + rerun on main showing the identical failures with zero changes applied)

## Decisions made
- Named the shared helper `createNotification` in `lib/notifications/create-notification.ts` (spec's own suggested name/location) rather than extending `lib/notifications/fanout.ts` — fanout.ts is explicitly documented as pure/no-I/O ("no Supabase client, no React, no I/O, no module-level state"); putting an actual RPC call there would violate that file's own stated contract.
- The helper never throws — every call site can `await` it directly without wrapping in its own try/catch purely for RPC-failure purposes, collapsing three near-identical try/catch/console.error blocks into one call each.
- `notifyNewlyMentionedUsers` (lib/notifications/mentions.ts, the one call site that already checked `error` correctly) was also converted to the shared helper for consistency — one source of truth for "how do we call create_notification and log a failure," not four (three broken + one already-correct).
- Fixed the board's `?taskId=` deep-link gap by REMOVING the `tasks.some(...)` guard rather than adding a new fetch-by-id lookup: `useTaskDetailSheet().openTask` already performs its own `getTaskDetail` server round trip unconditionally (see lib/board/use-task-detail-sheet... err use-task-detail-sheet.ts's `fetchDetail`), independent of what's in the board's locally-loaded `tasks` array, and `getTaskDetail` already re-checks visibility/access server-side. Adding a second "does this task exist" lookup before calling `openTask` would have been a redundant, second implementation of the same check — simpler option, no new dependency, no second source of truth.
- `commentId` on `NotificationListItem` is typed optional (`commentId?: string | null`) rather than required, so the several existing test fixtures across tests/unit/notification-bell-panel.test.tsx that construct `NotificationListItem` literals without it don't all need touching — undefined is treated identically to null by `taskHref`.
- Comment highlight is done via `document.getElementById`/`classList` inside a `useEffect` in CommentList rather than a second parallel ref map keyed by comment id — simplest option matching this codebase's existing "no second source of truth" convention (see this file's own doc comments elsewhere), and comment ids are already unique DOM-safe strings.

## Out-of-scope work needed
None identified beyond this feature's two fixes.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to remove the board's local-array existence guard entirely (rather than adding a dedicated lightweight "does task X exist" query before calling openTask) because openTask's existing getTaskDetail call already IS that lightweight query with proper access-control re-checking — adding a second one would have been the exact "second source of truth" this mission's conventions repeatedly warn against.
AUTONOMOUS_DECISION: Placed the shared notification helper at lib/notifications/create-notification.ts (spec offered this as one of two acceptable names/locations); did not extend lib/notifications/fanout.ts since that module is explicitly documented as I/O-free.

## Notes for the next worker
- No MCP tools were needed for this feature — it's pure application code (Server Actions, a query, and React components) plus tests; the only Supabase interaction is via the existing SDK client patterns already established in the touched files. The real-Supabase integration test (tests/integration/notification-error-observability.test.ts) exercises the actual linked project's `create_notification` RPC (from supabase/migrations/20260823030000_fix_create_notification_spoofing.sql) by intentionally supplying a non-member recipient id, which makes the RPC's own membership check `raise exception` — a genuine, not mocked, RPC failure.
- The full-suite `npx vitest run` run showed 54 failing test files, but every one of them fails identically on `main` before this feature's changes (verified via `git stash` + rerun) — they're Supabase Auth rate-limiting ("Request rate limit reached") from running dozens of integration tests' `auth.admin.createUser`/`signInWithPassword` calls back-to-back in one process, plus one unrelated JWT-clock-skew flake and one pre-existing missing-env-var unit test failure. None of the 54 touch any file this feature modified. Running the notification/board-specific suites in isolation (see Commands run) is clean.
