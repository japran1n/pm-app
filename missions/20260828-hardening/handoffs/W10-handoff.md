# Handoff: W10 — Pagination (chat load-more UI + task list page-size cap)

## Status
COMPLETE

## Assertions covered
This worker was not assigned validation-contract assertion IDs (task
description was a direct engineering brief, not a feature spec tied to
AS-NNN IDs). No assertions to report.

## Files changed
lib/actions/chat-messages.ts
components/chat/channel-view.tsx
components/chat/message-list.tsx
lib/queries/tasks.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, pre-existing warnings only)
`npx vitest run tests/unit` (0) — 179 files / 1392 tests passed

## Decisions made
- Sub-task A: added `getChannelMessagesAction` in `lib/actions/chat-messages.ts`,
  a thin Server Action wrapper around the existing `getChannelMessages(channelId, { before, limit })`
  query — same "wrap the server-only query for a Client Component" convention
  the file already used for `getThreadMessagesAction`.
- `ChannelView` now owns `hasMoreMessages` / `isLoadingMoreMessages` state and
  a `handleLoadMoreMessages()` that calls the action with
  `before = oldest message's createdAt` and prepends the (deduped, re-sorted)
  result to its `messages` state. `hasMoreMessages` is set to false once a page
  returns fewer than the page size (50, matching `getChannelMessages`'s own
  default and the initial page fetched by
  `app/(workspace)/w/[workspaceSlug]/chat/[channelId]/page.tsx`, which does not
  pass an explicit `limit`).
- `MessageList` renders a "Load earlier messages" button at the top of the
  scroll container when `hasMoreMessages` is true, disabled/labelled "Loading…"
  while in flight, and hidden once there's nothing earlier to load.
- Added prepend-detection to `MessageList`'s existing auto-scroll effect (compares
  the previous vs. new first message id) so a "load more" click does not jump the
  viewer to the bottom the way a genuinely new incoming message does. This does not
  fully restore the exact prior scroll offset (kept simple per the brief) — the
  viewport can shift slightly when older content is prepended above the current
  scroll position, but it no longer force-scrolls to the bottom.
- The older page returned by `getChannelMessagesAction` doesn't carry
  `attachments` (that field is only populated by the send/edit code paths in
  this file, not by the plain `getChannelMessages` read), so prepended messages
  are mapped with `attachments: undefined` rather than relying on structural
  typing to paper over the mismatch — matches `ChatMessage.attachments`'s
  already-optional shape; existing message rows in the list still show their
  attachments untouched.

- Sub-task B: read `lib/queries/tasks.ts` in full. Three read paths return
  `TaskCardTask[]`: `getProjectBoardTasks` (backed by the `get_project_board_tasks`
  Postgres RPC), `getProjectListTasks`, and `getWorkspaceListTasks` (workspace-wide
  dashboard table). Per the brief's documented fallback, implemented the
  **backend safety-cap-only** path rather than a full cursor rewrite:
  - `getProjectListTasks` and `getWorkspaceListTasks` (both plain PostgREST
    queries) now have `.limit(1000)` added after their existing `.order(...)`
    calls — a project/workspace with more tasks than that no longer does a truly
    unbounded fetch, without changing either function's signature or return shape.
  - `getProjectBoardTasks` was **not** capped: it calls a Postgres RPC
    (`get_project_board_tasks`) that takes only `p_project_id` — adding a
    limit/offset parameter would require a new migration, and this worker's
    instructions prohibit modifying migration files. Left as-is; documented
    below as out-of-scope follow-up.
  - No UI ("Load more" button) was added for tasks — see rationale in
    Out-of-scope work needed. `TaskCardTask[]` results flow through the List
    view page, the workspace dashboard table, and several client components
    downstream (filters, sort, KPI tiles for `getWorkspaceListTasks`'s
    post-fetch `flag` filtering) before rendering; wiring a real cursor end to
    end through all of that is a multi-file rewrite well beyond a "add a
    button" change, matching the brief's own "implement backend limit only"
    fallback condition.

## Out-of-scope work needed
- Full cursor-based "Load more" UI for the task list/board views (F-style
  follow-up). Needs: (1) a migration adding `p_after_position`/`p_limit`
  params to `get_project_board_tasks` (board view is RPC-backed, can't be
  capped from the query layer alone), (2) extending `getProjectListTasks`/
  `getWorkspaceListTasks` to accept a `cursor?: { after: string; limit: number }`
  and return it via `.range()` or `.gt("id"/"created_at", ...)`, (3) UI state
  in the List/Board page components (Server Components today — would likely
  need a client wrapper) to track pages fetched and expose a "Load more"
  button, (4) for `getWorkspaceListTasks` specifically, deciding how the
  post-fetch `overdue`/`due_soon`/`completed` flag filters and the dashboard's
  KPI tile counts should interact with pagination (today they run against the
  full — now capped-at-1000 — result set; a real cursor makes that
  interaction trickier since the flags aren't filterable at the SQL level for
  those three).
- Chat "Load earlier messages" scroll-position preservation is approximate
  (see Decisions made) — a future pass could anchor scroll exactly to the
  previously-topmost message by measuring `scrollHeight` delta before/after
  the DOM update, the way some virtualized list libraries do.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: For task pagination, applied the brief's own documented
fallback ("if impractical without a large rewrite... implement the backend
limit only... and document the UI deferral") because `TaskCardTask[]` results
flow through 3+ layers (RPC/query -> Server Component page -> multiple client
components consuming filters/sort/KPIs) for all three read paths, and one of
the three (board) is RPC-backed and can't take a `.range()`/`.limit()` at the
query-builder level without a new migration, which is prohibited for this
worker.

## Notes for the next worker
- `getChannelMessages` (lib/queries/chat.ts) already supported `{ before, limit }`
  cursor pagination before this change — only the UI/action wiring was missing.
- `get_project_board_tasks` RPC is defined across several migrations under
  `supabase/migrations/2026082*_rpc_project_board_tasks*.sql` — any future
  pagination work on the board view needs a new migration in that same series,
  not an edit to the existing ones.
- No MCP tools were used for this task (pure application code / query changes,
  no live schema or policy inspection needed).
