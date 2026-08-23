# Handoff: F208 (follow-up) — Notification task links open the actual task

## Status
COMPLETE

## Assertions covered
AS-386: PASS — clicking a notification's task link now navigates to `/w/{slug}/projects/{projectId}/board?taskId={taskId}` and the board opens that task's detail sheet on mount (component-level jsdom test proves the sheet actually opens and shows the task's title, not just source inspection). Verified with both a new board-page test (`tests/unit/board-taskid-deeplink.test.tsx`) and a new notification-panel test asserting the produced href (`tests/unit/notification-bell-panel.test.tsx`).

## Files changed
components/board/board.tsx
components/notifications/notification-panel.tsx
lib/queries/notifications.ts
tests/unit/board-taskid-deeplink.test.tsx (new)
tests/unit/notification-bell-panel.test.tsx
tests/unit/board-task-detail-sheet-wiring.test.ts
tests/unit/board-dnd-setup.test.ts
tests/unit/board-move-status-wiring.test.ts
tests/unit/board-optimistic-rollback-toast.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0, 2 pre-existing unused-var warnings unrelated to this change)
`npx vitest run` (0 — full suite: 1491 passed, 20 failed, 114 skipped; all 20 failures are pre-existing live-Supabase integration tests failing on rate limiting/timeouts — `tests/integration/workspace-role-expansion.test.ts`, `tests/integration/workspace-time-by-person.test.ts`, and others in that family — confirmed via source grep that none reference board/notification/task-detail/deeplink code; not touched by this change)
`npx vitest run tests/unit/board-taskid-deeplink.test.tsx tests/unit/board-task-detail-sheet-wiring.test.ts tests/unit/board-dnd-setup.test.ts tests/unit/board-move-status-wiring.test.ts tests/unit/board-optimistic-rollback-toast.test.ts tests/unit/notification-bell-panel.test.tsx` (0, all green)

## Decisions made
- Board deep-link is client-side (`useSearchParams()` inside the existing "use client" `Board` component), not a server `searchParams` prop on the page — the sheet-opening state (`useTaskDetailSheet`) already lives entirely client-side in `Board`, so this is additive to that existing seam rather than threading a new prop down from the Server Component page.
- The effect that opens the sheet from `?taskId=` only fires when `onCardClick` is not overridden — a caller that supplies its own click handler owns its own click behavior; the effect also no-ops if the sheet is already open, so a user who's since interacted with a different card is never fought.
- `taskHref` in the notification panel now branches on `task.projectId`: when present, it builds the board deep-link; the search-page link is kept ONLY as a fallback for a genuinely unresolvable task (soft-deleted, per the same `title === null` gate already in place) or an unresolvable project id.
- `projectId` was added to `getNotificationsForWorkspace`'s per-task shape by adding one column (`project_id`) to the existing batched `tasks` select — no new query, matching this feature's original "no N+1" budget. Nulled out for soft-deleted tasks, same as `title`, so the fallback path is taken together with the existing deleted-task handling.
- New board-page test uses vitest's per-file jsdom opt-in (`// @vitest-environment jsdom`, same pattern as `tests/unit/notification-bell-panel.test.tsx` and `tests/unit/user-avatar.test.tsx`) since asserting the sheet actually renders the fetched task's title needs a real DOM, not source inspection. Mocked `@/lib/actions/tasks` (`getTaskDetail`) and `@/lib/actions/comments` (`getMentionCandidates`, called by the sheet's comment box) and set dummy `NEXT_PUBLIC_SUPABASE_*` env vars so `useBoardRealtime`'s browser client construction doesn't throw in jsdom — none of that is exercised or asserted on by this test.

## Out-of-scope work needed
None identified beyond what's already closed here. (F208's handoff separately noted the search page's own AS-120 already had the identical "no deep link" limitation in its own doc comment — this fix's `?taskId=` param on the board page also resolves that gap for any future caller, e.g. a future search-results "open task" link, but no other feature currently reads AS-120's task links to point at it, so wiring the search page itself is left for whoever picks that up.)

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose client-side `useSearchParams()` over a server `searchParams` page prop, per the task's own guidance ("read a `?taskId=<uuid>` search param... via client-side `useSearchParams()` if the sheet-opening logic is client-only") — `Board`'s sheet state is entirely client-side, so this was the simpler option with no new prop-drilling and no dependency changes.

## Notes for the next worker
- The board's `?taskId=` effect validates the id against the board's already-loaded `tasks` array before calling `openTask` — a stale/foreign task id (e.g. task on a different project, or already deleted) is silently ignored rather than opening an empty/errored sheet.
- No MCP tools were used for this fix — it's pure application code (Next.js query param + existing client hook), no live schema/policy changes; `lib/queries/notifications.ts`'s new `project_id` column read is a plain Supabase JS query against the existing `tasks` table, no migration needed.
