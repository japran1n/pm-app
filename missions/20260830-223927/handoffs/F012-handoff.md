# Handoff: F012 — Palette search realtime reconcile

## Status
COMPLETE

## Assertions covered
AS-023: PASS — unit test `AS-023: updates the matching task's title on UPDATE` in tests/unit/palette-search-realtime.test.ts (reconcilePaletteSearchResults applies UPDATE to matching task's title in-place)
AS-024: PASS — unit test `AS-024: removes the matching task on DELETE` in tests/unit/palette-search-realtime.test.ts (reconcilePaletteSearchResults removes matching task on DELETE)

## Files changed
components/command/command-palette.tsx
lib/hooks/use-palette-search-realtime.ts (new)
lib/palette/subscribe-palette-search-realtime.ts (new)
lib/palette/reconcile-palette-search-results.ts (new)
tests/unit/palette-search-realtime.test.ts (new)

## Commands run
`npx vitest run tests/unit/palette-search-realtime.test.ts` (0)
`npm test` (0)
`npm run lint` (0, 13 pre-existing warnings unrelated to this feature, 0 errors)
`npx tsc --noEmit` (0)

## Decisions made
- Split into three files mirroring the board realtime pattern (lib/board/subscribe-board-realtime.ts / reconcile-realtime-task.ts / use-board-realtime.ts): `subscribe-palette-search-realtime.ts` (plain Supabase channel wiring via `acquireSharedTopicChannel`, testable without React/DOM), `reconcile-palette-search-results.ts` (pure UPDATE/DELETE reducer over `PaletteSearchResults`), and `use-palette-search-realtime.ts` (the thin `useEffect` hook wired into `command-palette.tsx`). This follows the clarified "Pattern" answer exactly and keeps the reconciliation logic unit-testable without mocking React.
- Topic is `tasks:${workspaceId}` per the clarified follow-up decision — subscribes to ALL `tasks` table changes (no server-side row filter), relying on RLS (`tasks_select_active_members`) to scope what actually arrives, per the clarified "Access control: RLS at subscription level; no extra client check" answer.
- `PaletteTaskResult` (lib/palette/palette-search-types.ts) has no `status` field — only `title`/`projectId`/`projectName`/`projectKey`/`number` are rendered in the palette. The clarified spec's "update title/status" therefore reduces to "update title" in practice, since there is no status to patch on this result shape; DELETE removal is unaffected by this.
- Debounce is buffer-and-coalesce: incoming events are pushed into a ref-held queue and a single `setTimeout(100ms)` flush reduces all queued events through `reconcilePaletteSearchResults` in one `setResults` call, rather than debouncing/dropping events (a burst of 3 rapid UPDATEs to 3 different tasks all still land, just batched into one state update within the 100ms window) — satisfies "no more than once per 100ms" without losing any individual task's update.
- Hook subscribes/unsubscribes on `query.length > 0` transitions (not on every keystroke) via a `useEffect` dependency of `[workspaceId, query.length > 0]`, matching "Subscribe in useEffect when query.length > 0; cleanup on query going to 0". This avoids re-subscribing to the same shared-topic-channel on every keystroke while a query is non-empty — the shared channel helper would no-op cheaply either way, but this is more explicit about the intended lifecycle.
- Passed raw `query` (not the trimmed value used for `hasQuery`/search execution) into the hook's `query.length` check, per the clarified answer's literal wording ("query.length > 0"). A whitespace-only query therefore still subscribes even though it produces no search results — harmless (reconcile against an empty task list is a no-op) and matches the spec text exactly rather than inferring trimming.
- Reconciliation never calls `searchPalette` or any other server action — satisfies the definition-of-done's "side-effect verification: reconcile doesn't fire new server search."

## Out-of-scope work needed
- INSERT events on the `tasks` table are intentionally ignored by `reconcilePaletteSearchResults` (a new task appearing mid-search would require re-running the actual search query server-side to know if/where it belongs, which the clarified spec's "Failure handling: results stay stale — acceptable" and the assertion text (which only covers UPDATE/title and DELETE) don't require). If a future feature wants "new matching tasks appear live," it needs its own spec/assertion.
- No Playwright/e2e coverage of true two-tab live delivery (manual verification step in the definition of done) — same reasoning as the pre-existing board realtime test file's documented limitation: real two-connection WebSocket delivery is flaky in a fast unit suite and better suited to an e2e test with two browser contexts, which is out of scope for this feature.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Debounce implemented as "coalesce all queued events into one state update per 100ms window" rather than "drop all but the last event within 100ms" — chosen because the spec only constrains reconciliation *frequency* ("no more than once per 100ms"), not which events may be dropped, and coalescing preserves correctness for AS-023/AS-024 even when multiple different tasks change within the same debounce window (a "last event wins" approach would silently drop a DELETE for task A if a later UPDATE for task B arrived in the same window).

## Notes for the next worker
- `lib/realtime/shared-topic-channel.ts` has an extensive header comment explaining why a naive `supabase.channel(topic).on(...).subscribe()` per-hook-instance pattern crashes under React StrictMode — read it before writing any new realtime hook in this repo; every existing subscribe* module (board, comments, notifications, chat messages/reactions/unread, presence, typing) already uses `acquireSharedTopicChannel`.
- No MCP was needed for this feature (registry: none required per the feature spec's own "MCP at run: none" note); `tasks` Realtime is already enabled at the Postgres replication level from F049's migration (`supabase/migrations/20260818040000_realtime_tasks_publication.sql`), so no new migration was needed here.
