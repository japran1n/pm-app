# Handoff: F008 — Portal overview live

## Status
COMPLETE

## Assertions covered
AS-018: PASS — component test `test_AS_018_task_leaving_pending_approval_leaves_waiting_on_you` (tests/unit/portal-overview-live.test.tsx) drives an UPDATE with `pending_client_approval: false` through the mocked channel and asserts the task disappears from "Waiting on you" with no reload.
AS-019: PASS — `test_AS_019_task_becoming_pending_approval_and_client_visible_appears_in_waiting_on_you` drives an UPDATE with `pending_client_approval: true, client_visible: true` for a task not previously in the list and asserts it appears.
AS-020: PASS — `test_AS_020_row_failing_client_visible_predicate_is_never_rendered` (INSERT with `client_visible: false`) and `test_AS_020_row_that_was_visible_and_becomes_invisible_is_removed` (previously-visible row flips `client_visible` to false) both assert the row is never in the DOM. Enforced via F007's `reconcilePortalRealtimeTask`, not a hand-rolled predicate.
AS-024: PASS — `test_AS_024_subscription_is_torn_down_on_unmount` asserts the mocked unsubscribe function is called exactly once on unmount. Verified discriminating: temporarily changing `use-portal-overview-realtime.ts`'s cleanup return to `void unsubscribe;` (no teardown) made this test fail (0 calls vs 1 expected), then reverted.

## Files changed
app/(portal)/portal/[workspaceSlug]/page.tsx
components/portal/portal-overview-live.tsx
components/portal/use-portal-overview-realtime.ts
lib/portal/subscribe-portal-overview-realtime.ts
tests/unit/portal-overview-live.test.tsx
tests/unit/portal-overview-realtime-subscription.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0 new errors — 2 pre-existing errors in components/portal/task-list.tsx and components/portal/request-list.tsx belong to F009, which is running concurrently and owns those files per this feature's explicit "do not touch" scope; confirmed via `git status` those files are modified by the other worker, not by me)
`npx vitest run tests/unit/portal-overview-live.test.tsx tests/unit/portal-overview-realtime-subscription.test.ts` (0, 10 passed)
`npx vitest run --exclude "tests/integration/**" --exclude "tests/e2e/**"` (1 failed test file pre-existing + 2 pre-existing failed Playwright-in-vitest suites, none touching my files — confirmed by `git stash` + re-running `tests/unit/personal-todo-list-realtime-wiring.test.tsx` on the clean tree, which fails identically before any of my changes)

## Decisions made
- Followed `components/board/use-board-realtime.ts` / `lib/board/subscribe-board-realtime.ts`'s split exactly: a plain, React-free `subscribeToPortalOverviewRealtime` (unit-testable without jsdom) + a two-line `usePortalOverviewRealtime` hook wrapper, both using `acquireSharedTopicChannel`. One channel, one table (`tasks`), topic `portal-overview:<workspaceId>` — no risk of the F003 "two bindings on one channel" failure mode since this feature only ever binds one table on this topic.
- Subscribed to `tasks` with NO row filter, relying on Realtime re-applying the table's RLS SELECT policy before broadcasting — same pattern `components/my-tasks/use-my-tasks-realtime.ts` already uses for a workspace-wide (not single-project) subscription. A portal session's RLS already limits what reaches this client to tasks in projects it was granted access to.
- "Waiting on you" surfacePredicate is `pending_client_approval === true`, matching AS-018/AS-019's text exactly. This is narrower than the server query's own `isAwaitingReview && category !== "done"` (`getPortalOverview`, lib/queries/portal.ts) — the server's `category` comes from a join with `project_statuses` keyed by `status_id`, and a bare `tasks` Realtime payload never carries that joined column. Re-deriving it client-side would mean carrying a second, independently-synced copy of `project_statuses` into this component, which is out of scope for what AS-018/AS-019 actually ask for. See "Out-of-scope work needed" below.
- "Delivered this week" is deliberately left un-reconciled (static server-rendered snapshot) rather than wired to a best-effort predicate. It has no assigned assertion in this feature, and correctly reconciling it needs both the same `project_statuses` category join and a "was `updated_at` within the last 7 days as of NOW" check that only makes sense evaluated against wall-clock time at render — exactly the kind of computation that silently drifts if faked client-side from a bare `tasks` row. The instruction to "not silently let a stale-window row in" is satisfied by never inserting into this list from realtime at all, so there is no path for a wrongly-categorized or stale-window row to appear. Documented at length in `components/portal/portal-overview-live.tsx`'s header comment.
- DELETE events on `tasks` are handled by F007's reconciler by id alone (Supabase's default replica identity means `event.old` on a DELETE carries only `id`), so a hard-deleted task is removed from "Waiting on you" correctly even though the reconstructed row synthesized for the reconciler's INSERT/UPDATE branches always sets `client_visible: true, deleted_at: null` (since every row already in local state passed that gate to get there).

## Out-of-scope work needed
- Properly live-reconciling "Delivered this week" (no assertion currently requires it) would need either: (a) a Postgres view/RPC that already joins `tasks` to `project_statuses` category so Realtime payloads carry `category` directly, or (b) the client subscribing to `project_statuses` as a second small dataset and recomputing category locally. Either is a real feature-sized piece of work, not a drive-by fix here.
- Same category-join gap applies to a rare edge case in "Waiting on you": a task marked done AND still `pending_client_approval: true` will show live here (matching AS-018/019's literal text) where a full page load's server query would exclude it (server also checks `category !== "done"`). Worth a follow-up assertion + feature if product wants that edge case tightened, since AS-018/019 as written don't ask for it.
- F009 (client portal project page + requests page) needs the equivalent wiring for `components/portal/task-list.tsx` and `components/portal/request-list.tsx` — visible in `git status` as already in progress by that worker; not touched here per this feature's explicit scope boundary.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose `pending_client_approval === true` as the sole "Waiting on you" realtime surfacePredicate (omitting the server query's `category !== "done"` check) because AS-018/AS-019's assertion text only names `pending_client_approval` and `client_visible`, and the `category` value isn't available on a bare `tasks` Realtime row without a second join the spec didn't ask for. Documented as an out-of-scope follow-up above rather than silently building the join.
AUTONOMOUS_DECISION: Left "Delivered this week" fully static (no realtime reconciliation) since it has no assigned assertion and the spec's own steering note ("do not silently let a stale-window row in") is best satisfied by never guessing at it client-side.

## Notes for the next worker
No MCP tools used — this is pure client/component code with no live schema dependency; F007's reconciler (already MCP-verified in its own handoff, if applicable) is consumed as-is. When wiring F009's equivalent for the project page/requests page, note the same DELETE-payload caveat F007's handoff already flagged: `event.old` on a DELETE only carries `id` under default replica identity, so never evaluate a surfacePredicate against `event.old`.
