# Handoff: F104 — comment delete realtime fix

## Status
COMPLETE

## Assertions covered
AS-101: PASS — verified via `tests/integration/comment-delete-broadcast.test.ts` (real Realtime broadcast delivered by a genuinely independent client, plus the existing DB-side soft-delete assertion) and `tests/unit/comment-realtime-subscription.test.ts`'s updated wiring tests.

## Files changed
lib/actions/comments.ts
lib/tasks/subscribe-comments-realtime.ts
tests/unit/comment-realtime-subscription.test.ts
tests/integration/comment-delete-broadcast.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0, 1 pre-existing unrelated warning in lib/queries/search.ts)
`npx vitest run tests/unit/comment-realtime-subscription.test.ts tests/unit/comment-list.test.ts` (0)
`npx vitest run tests/integration/comment-delete-broadcast.test.ts --no-file-parallelism` (0)
`npx vitest run tests/integration/delete-comment.test.ts tests/integration/rls-comments.test.ts tests/integration/add-comment.test.ts --no-file-parallelism` (0)
`npx vitest run --no-file-parallelism` (0) — 68 files / 379 tests passed
`npm run build` (0)

## Decisions made
- Fixed exactly as scoped by M6-scrutiny.md's AS-101 finding and F104's draft scope: switched the delete-notification path from `postgres_changes` to Realtime Broadcast, sent explicitly from `deleteComment` (`lib/actions/comments.ts`) right after the soft-delete UPDATE succeeds, on channel `comments:<taskId>`, event `comment_deleted`, payload `{ id: commentId }`.
- Used the comment's real task id (looked up server-side from `commentRow.tasks.id`, same convention the function already uses for `workspaceId`) for the channel name — not the client-supplied `commentId` — so the channel matches exactly what `use-comments-realtime.ts` subscribes to.
- The broadcast send uses the request-scoped `supabase` client (from `createClient()`, matching the spec's literal suggested code), not the admin client — broadcast doesn't need RLS bypass, and this keeps the call shape identical to what a real client-side sender would use.
- The broadcast send is wrapped in try/catch and treated as non-fatal: if it fails, the soft-delete itself has already succeeded and is still the source of truth (AS-102/reload is unaffected by broadcast delivery either way). Logged via `console.error`, same convention as this file's `revalidatePath` non-fatal-failure handling.
- In `lib/tasks/subscribe-comments-realtime.ts`: restricted the existing `postgres_changes` listener from `event: "*"` to `event: "INSERT"` only (UPDATE/DELETE are no longer relied on for anything — INSERT still works because a freshly-inserted row's own values always pass the SELECT RLS policy, so AS-103 is unaffected), and added a second `.on("broadcast", { event: "comment_deleted" }, ...)` listener on the same channel. The broadcast handler translates `{ payload: { id } }` into a synthetic DELETE-shaped `CommentRealtimeEvent` (`{ eventType: "DELETE", old: { id }, new: {} }`) so it flows through the existing, unchanged `reconcileComment` reducer and its existing DELETE-path tests/behavior — no second removal code path was introduced in `comment-list.tsx` or `reconcile-realtime-comment.ts`.
- `components/task/use-comments-realtime.ts` needed no changes: it's a thin `useEffect` wrapper around `subscribeToCommentsRealtime` and forwards whatever `onChange` receives, so the fix was fully containable in the plain-function layer per this repo's existing River-testable-logic convention.
- Documented the accepted broadcast-is-not-RLS-gated-at-transport-level tradeoff in both `lib/actions/comments.ts` (sender) and `lib/tasks/subscribe-comments-realtime.ts` (receiver), per F104's explicit instruction to "document the reasoning explicitly" — reasoning: the channel name embeds `task_id`, and the only code that ever subscribes to it only does so for a task the current viewer already independently passed the normal RLS-gated fetch for; the payload is a bare comment id, no sensitive data.
- Integration test approach: per F104's stated acceptable-middle-ground option, `tests/integration/comment-delete-broadcast.test.ts` subscribes to the real `comments:<taskId>` broadcast channel from the test process itself — a genuinely separate `SupabaseClient`/websocket connection from the one `deleteComment`'s mocked `createClient()` uses internally — waits for `SUBSCRIBED`, then calls the real `deleteComment` Server Action and asserts the broadcast actually arrives with the correct comment id (plus the underlying soft-delete's `deleted_at` side effect). This is the single-independent-subscriber middle ground rather than a second fully-authenticated "other viewer" session, because the AS-101 regression class (an event silently never reaching *any* subscriber) doesn't depend on which client authored the subscription — see the long comment at the top of that test file for the full rationale.
- Kept the existing unit-test file (`tests/unit/comment-realtime-subscription.test.ts`) rather than deleting/replacing it: updated its `subscribeToCommentsRealtime` tests to match the new INSERT-only + broadcast wiring, added new tests for the broadcast→DELETE-event translation and a missing-payload-id no-op case, and left `reconcileComment`'s existing AS-101/AS-102/AS-103 tests untouched since that pure reducer's behavior/contract did not change.

## Out-of-scope work needed
None identified beyond what's already tracked in M6-scrutiny.md's other recommended follow-ups (CI secret-coverage guard, AS-121 id-absence assertion, AS-114 partial-failure branch test) — none of those are in F104's scope and none were touched.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used the request-scoped `supabase` client (not the admin client) for the broadcast send, since the feature spec's suggested code (`supabase.channel(...).send(...)`) uses the plain client and broadcast doesn't require RLS bypass — this keeps the implementation minimal and matches the exact pattern the spec called out.

AUTONOMOUS_DECISION: For the required integration test, chose the single-independent-subscriber middle ground explicitly permitted by the feature spec (rather than a second fully-authenticated two-user session) — documented at length in the test file itself and above, since the regression this test guards against is about delivery to any subscriber, not about cross-user authorization (which is already covered by AS-098/099/100's existing tests).

## Notes for the next worker
- The broadcast payload shape sent by `deleteComment` is `{ type: "broadcast", event: "comment_deleted", payload: { id: commentId } }` — any future consumer of this channel/event should match that shape exactly (see `lib/tasks/subscribe-comments-realtime.ts`'s `.on<{ id: string }>("broadcast", { event: "comment_deleted" }, ...)` for the typed callback pattern used to work around `@supabase/realtime-js`'s `.on()` overload resolution, which otherwise picks the wrong overload and fails `tsc` with a confusing "not assignable to '\"system\"'" error).
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` were not both confirmed present in `.env` by name — the new integration test falls back to `SECRET_KEY` if neither is set, so it still runs correctly under `haveAdminCreds`, but if a future worker adds a proper anon/publishable key to `.env`, no change is needed here since the fallback chain already prefers it.
