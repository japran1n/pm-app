# Handoff: F202 — live reactions

## Status
COMPLETE

## Assertions covered
AS-369: PASS — reactions appear live for other viewers without a reload.
Proven at two levels: `tests/integration/reaction-realtime-delivery.test.ts`
(real Supabase project, real `toggleReaction` call) shows a real INSERT into
`comment_reactions` is actually delivered over the wire via `postgres_changes`
to an independent, separately-connected subscriber on the same channel
`subscribeToReactionsRealtime` uses, with the correct
comment_id/user_id/emoji — 1/1 passed. `tests/unit/reactions-realtime-
subscription.test.ts` proves the client-side wiring: channel/event/table
configuration, INSERT/DELETE payload → `ReactionRealtimeEvent` translation,
and (reproducing `comment-list.tsx`'s own callback logic against the real
`applyReactionToggle` reducer it calls) that an incoming event from another
viewer is folded into the affected comment's `reactions`, an event for an
unrelated comment is a no-op, and — the "don't echo the caller's own
optimistic update twice" guard the spec calls for — an event carrying the
current viewer's own user id is skipped entirely — 10/10 passed.

## Files changed
lib/tasks/subscribe-comments-realtime.ts
components/task/use-reactions-realtime.ts (new)
components/task/comment-list.tsx
tests/unit/reactions-realtime-subscription.test.ts (new)
tests/integration/reaction-realtime-delivery.test.ts (new)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors; 2 pre-existing unrelated warnings in
lib/queries/search.ts and tests/unit/invite-member-pagination.test.ts,
unchanged by this feature)
`npx vitest run tests/unit/reactions-realtime-subscription.test.ts tests/unit/comment-reactions.test.ts tests/unit/comment-list.test.ts tests/unit/comment-realtime-subscription.test.ts tests/integration/reaction-realtime-delivery.test.ts` (0) — 47/47 passed
`npm run test` (full vitest suite, real Supabase project) — 1388 passed, 131
skipped, 17 failed across 49 files, all pre-existing `Request rate limit
reached` / `Test timed out in 30000ms` failures in unrelated integration
tests (e.g. `workspace-role-expansion.test.ts`, `workspace-time-by-
person.test.ts`) hitting Supabase Auth signup/signin rate limits during a
full-suite run — the same known, documented flakiness pattern already noted
in prior handoffs (F127, F159, F163, F191, F199, F201). No failure mentions
"reaction" or touches any file this feature changed; this feature's own
coverage (listed above) passed cleanly in isolation.

## Decisions made
- **No broadcast workaround needed (unlike F104's comments channel).**
  `comment_reactions_select_visible`'s RLS predicate (F199's migration)
  depends only on the reacted-on comment's task being visible to the
  caller (`public.is_task_visible_to`), which never changes as a side
  effect of a reaction's own INSERT/DELETE — unlike a comment's
  soft-delete, which flips the very `deleted_at` column its own SELECT
  policy gates on. So plain `postgres_changes` (both INSERT and DELETE)
  is sufficient and is what's used, verified live in the integration test
  above. AUTONOMOUS_DECISION: per the clarified ambiguity-resolution
  answer ("simpler option, no new dependency, no second source of
  truth") this avoids adding a broadcast side-channel purely to mirror
  F104's pattern where the underlying bug it worked around doesn't apply
  here.
- **DELETE payloads carry full identity without `REPLICA IDENTITY FULL`.**
  `comment_reactions`' composite primary key is exactly
  `(comment_id, user_id, emoji)` (F199), and Postgres always includes
  primary-key columns in a DELETE's replicated OLD row regardless of
  replica identity — so no migration change was needed to make DELETE
  events usable.
- **A new, separate channel/function (`subscribeToReactionsRealtime`),
  not folded into `subscribeToCommentsRealtime`.** `comment_reactions`
  has no `task_id` column, so unlike the comments channel it can't be
  given a `filter: task_id=eq.<taskId>` postgres_changes clause;  this
  channel subscribes to all `comment_reactions` changes (RLS still gates
  which rows are actually sent) and the caller filters client-side by
  matching `commentId` against the task's already-loaded comments — same
  shape as `use-reactions-realtime.ts`'s doc comment describes. Keeping
  it a separate exported function (same file, per the feature spec's
  Files list) also avoids widening `subscribeToCommentsRealtime`'s
  existing, already-tested `CommentRealtimeEvent` contract with an
  unrelated payload shape.
- **Guard against echoing the caller's own optimistic update**: the
  realtime handler in `comment-list.tsx` (`useReactionsRealtime`'s
  callback) returns early when `event.userId === currentUserId`, since
  that toggle was already applied optimistically by
  `handleReactionsChange` the instant `toggleReaction` resolved (F201).
  This isn't strictly required for correctness — `applyReactionToggle`
  is idempotent for a repeat add/remove of the same user+emoji — but
  avoids a redundant re-render/flicker.
- **Reused F201's `applyReactionToggle` reducer verbatim** to fold
  incoming events, per F201's own "Notes for the next worker" and this
  feature's clarified "no second source of truth" answer — no second
  reaction-summary-mutation implementation was written.
- **Wired directly into `comment-list.tsx`** (not left as a standalone,
  unused hook) — the feature spec's own scope line ("reconciling into
  the comment list state the same way `use-comments-realtime.ts` does")
  and DoD's "test type that fits" both point at actually completing the
  reconciliation, matching how `useCommentsRealtime` is wired in the same
  file. `comment-list.tsx` wasn't in the spec's approximate Files list,
  but the spec explicitly named "the comment list state" as the target,
  so this was treated as in-scope rather than reported as
  out-of-scope-only.
- **Primary test is a real-Realtime-transport integration test, not
  Playwright**, deviating from the spec's approximate
  `tests/e2e/reactions.spec.ts` filename. Rationale (see the test file's
  own doc comment): no page in this repo yet fetches
  `comment_reactions` server-side into a comment's `reactions` prop for
  an initial render (F201's handoff "Out-of-scope work needed" — the
  comments-loading Server Component caller itself doesn't exist yet), so
  a genuine two-browser-context Playwright test would have nothing
  server-rendered to click through to prove the *live* half of AS-369
  meaningfully; it would really just be testing page plumbing that isn't
  this feature's job. `tests/integration/comment-delete-broadcast.test.ts`
  (F104) already established exactly this "real Realtime transport,
  single test process, independent subscriber client" as an
  explicitly-sanctioned middle ground for this same class of problem;
  this feature follows that precedent. AUTONOMOUS_DECISION: chose the
  integration test over a Playwright spec because it's strictly more
  falsifiable for what F202 actually owns (real event delivery) given
  the current state of the app, and documented the reasoning inline so a
  future worker wiring the comments-loading page can add a true
  browser-level two-context test on top without needing to re-derive
  this reasoning.

## Out-of-scope work needed
- **Fetching comments (and their reactions) server-side into a real page.**
  Still not built anywhere in this repo as of this feature (confirmed:
  no route under `app/` fetches `comments`/`comment_reactions` and
  passes them to `TaskDetailSheet`/`CommentList`). This blocks a true
  browser-level Playwright test for AS-369 (see Decisions made above)
  and is the same gap F201's handoff already flagged. Recommended
  follow-up: a feature that adds `lib/queries/comments.ts`'s
  `getTaskComments` (joining `comment_reactions` grouped by
  `comment_id, emoji` into each comment's `reactions`) and wires it into
  whichever route composes `TaskDetailSheet` today. Once that lands, a
  genuine two-browser-context Playwright spec
  (`tests/e2e/reactions.spec.ts`) exercising the full click-through
  should be added on top of this feature's wiring.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: skipped the broadcast fallback F104 used for the
comments channel, since `comment_reactions_select_visible`'s RLS predicate
doesn't depend on any column a reaction's own INSERT/DELETE changes (see
Decisions made).
AUTONOMOUS_DECISION: wrote the primary AS-369 test as a real-Realtime
integration test (mirroring F104's sanctioned middle ground) instead of a
Playwright spec, because no page yet server-fetches comments/reactions to
click through (see Decisions made and Out-of-scope work needed).

## Notes for the next worker
- `subscribeToReactionsRealtime` and `ReactionRealtimeEvent` are exported
  from `lib/tasks/subscribe-comments-realtime.ts` (alongside the existing
  `subscribeToCommentsRealtime`/`CommentRealtimeEvent`) — reuse these
  directly rather than adding a second reactions-channel implementation.
- No Supabase MCP tool calls were needed at run time: F199's migration
  already added `comment_reactions` to the `supabase_realtime`
  publication in anticipation of this feature (confirmed by reading that
  migration file directly, and independently confirmed working by the
  integration test's real delivery). If a future worker wants to
  double-check the publication membership live, `mcp__supabase__execute_sql`
  against `pg_publication_tables` (per `comments/mcp-registry.md`) is the
  tool for that.
- The integration test signs the independent "subscriber" client in as
  the same reactor user (not a second distinct user) — deliberate, same
  rationale F104's `comment-delete-broadcast.test.ts` documents: what's
  under test is real transport delivery, not a second user's
  authorization (already covered elsewhere by RLS-focused suites).
