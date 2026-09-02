# Handoff: F009 — Portal project page and requests live

## Status
COMPLETE

## Assertions covered
AS-021: PASS — test_AS_021_status_or_title_change_lands_live (components/portal/task-list.test.tsx)
AS-022: PASS — test_AS_022_delete_removes_the_row_live, test_AS_022_client_visible_false_removes_the_row_live (components/portal/task-list.test.tsx)
AS-023: PASS — test_AS_023_insert_lands_live, test_AS_023_status_change_lands_live (components/portal/request-list.test.tsx)
AS-024: PASS — test_AS_024_channel_torn_down_on_unmount, test_AS_024_no_channel_leak_across_remount (both task-list.test.tsx and request-list.test.tsx)

## Files changed
components/portal/task-list.tsx
components/portal/task-list.test.tsx
components/portal/request-list.tsx
components/portal/request-list.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0 — no new errors; two pre-existing unrelated warnings elsewhere untouched)
`npx vitest run components/portal/task-list.test.tsx components/portal/request-list.test.tsx components/portal/approval-actions.test.tsx` (0, 16 passed)
`npx vitest run` (0 — full suite; 23 failing tests are all pre-existing integration tests hitting a live-Supabase "Request rate limit reached" sign-in error, unrelated to this feature; no portal test failures)

## Decisions made
- `PortalTaskList` now owns local `tasks` state seeded from the `project` prop, subscribes to `tasks` via `acquireSharedTopicChannel` (topic `portal:project:<id>:tasks`, one channel for the whole table per project page), and reconciles every event through F007's `reconcilePortalRealtimeTask` — never hand-rolled membership logic. Its own surface predicate is `row.project_id === projectId`; F007's module already enforces `client_visible && !deleted_at`.
- Because the raw `tasks` Realtime row is snake_case and has no `category` (that's derived from a `project_statuses` join at query time, not carried on the row), incoming events are first merged onto any existing tracked entry (preserving `category`/`statusId`/`dueDate` when the payload omits them) before being handed to the reconciler as a full `PortalTask`-shaped record. A brand-new task this session has never seen defaults to `category: "not_started"` — the safest default (never mistaken for finished work).
- `RequestList` now owns local `liveRequests` state seeded from the `requests` prop, subscribes to `client_requests` with **no row filter** (topic `portal:client-requests`) — same reasoning as `use-my-tasks-realtime.ts`'s `task_assignees` subscription: `client_requests_select_author_or_team`'s RLS policy already scopes what Realtime will ever deliver to this session, so a client-side filter would just duplicate a rule that could drift. Only INSERT/UPDATE are handled (AS-023's scope); withdraw (a delete-adjacent status-esque action) already has its own server-action + `router.refresh()` path and isn't part of this assertion.
- `projectName`/`convertedTaskTitle`/`convertedTaskStatus` are not present on the raw `client_requests` Realtime row (they require a join). Live-merged requests keep whatever value was already known for that id (from the seeded server list or an earlier event for the same project), falling back to `""`/`null` rather than a guess. Noted as an out-of-scope follow-up below since it's a real (if minor) display gap on a request whose very first appearance is via Realtime for a brand-new project.
- Replaced the two components' "reset local state to a fresh server-prop list" `useEffect`s with a render-time reset pattern (`if (prop !== seededProp) { setSeeded(prop); setState(...) }`) after `eslint-plugin-react-hooks`'s `react-hooks/set-state-in-effect` flagged the effect-based version as an error (calling `setState` synchronously inside an effect body). This is the documented React pattern for "adjusting state when a prop changes" (https://react.dev/learn/you-might-not-need-an-effect#adjusting-state-based-on-a-prop-change) and keeps AS-021–AS-024 behaviour identical.
- Both subscriptions are wired through the *real* `subscribeToPortalTaskListRealtime`/`subscribeToPortalRequestListRealtime` functions in tests (only `.channel()`/`.on()`/`.subscribe()`/`removeChannel` are mocked), so a regression to the membership gate, the merge logic, or the unmount teardown breaks the tests directly rather than via a mocked stand-in.

## Out-of-scope work needed
- `RequestList`'s live-merged rows never backfill `projectName`/`convertedTaskTitle`/`convertedTaskStatus` for a request this session has no prior knowledge of (e.g. a brand-new request to a project the client has never sent one to before, or an accept that just set `converted_task_id`). A future feature could either extend `getPortalRequests`'s realtime companion with a lightweight lookup, or have the RSC page do a `router.refresh()` on receipt of an event for an unknown id — out of this feature's `Files:` scope (task-list.tsx, request-list.tsx only), so not done here.
- `app/(portal)/portal/[workspaceSlug]/p/[projectId]/page.tsx` and `app/(portal)/portal/[workspaceSlug]/requests/page.tsx` were read but intentionally left untouched — both already pass exactly the props these live components need (`project`, `workspaceSlug` / `requests`), so no page change was required.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose "no row filter, rely on RLS" for the `client_requests` subscription (mirrors `task_assignees` in `use-my-tasks-realtime.ts`) rather than threading a `workspaceId` prop through `RequestList`, since the clarified spec's `Files:` list for this feature is exactly `task-list.tsx`, `request-list.tsx`, and their tests — not the page that renders `RequestList` — and RLS already provides the correct scoping without a client-side filter.
AUTONOMOUS_DECISION: Used the render-time "reset on prop change" pattern instead of an effect for reseeding local state from fresh server props, to satisfy the repo's `react-hooks/set-state-in-effect` lint rule while preserving the exact same seeding behaviour.

## Notes for the next worker
- `lib/portal/reconcile-portal-realtime-task.ts` (F007) is generic over any `T extends { id, client_visible, deleted_at }` — this feature is the second consumer after F008's "Waiting on you"/"Delivered this week" surfaces, so any future portal surface with its own membership predicate over `tasks` should reuse it the same way rather than re-deriving the visibility gate.
- `lib/realtime/shared-topic-channel.ts`'s ref-counted registry means the topic string IS the dedupe key — `portal:project:<projectId>:tasks` is scoped per project so two different project pages open in the same tab (unlikely, but possible via multiple tabs sharing one browser client) don't collide; `portal:client-requests` is intentionally a single fixed topic since there is only ever one request inbox per session.
- No MCP tools were used for this feature — it is pure client-side component work consuming an already-live migration (F006) and an already-implemented pure function (F007); nothing here required introspecting live Supabase state.
