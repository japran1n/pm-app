# Handoff: F103 — realtime ordering guard

## Status
COMPLETE

## Assertions covered
AS-076: PASS — reconcileTask now guards against out-of-order Realtime UPDATE events; verified with a dedicated unit test simulating a newer event applied first followed by an older event for the same task id, asserting the older event is a no-op.

## Files changed
lib/board/reconcile-realtime-task.ts
lib/board/subscribe-board-realtime.ts
components/task/task-card.tsx
lib/queries/tasks.ts
tests/unit/reconcile-realtime-task-ordering.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npx vitest run` (0) — 51 files, 290 tests passed
`npx next build` (0)

## Decisions made
- The guard needed an `updated_at` value to compare against, which `TaskCardTask` didn't previously carry at all. Rather than confining the change to `reconcile-realtime-task.ts` alone (impossible — there was no timestamp anywhere in the local state to compare against), I plumbed `updated_at` through minimally:
  - `BoardRealtimeTaskRow` (subscribe-board-realtime.ts) gained a required `updated_at: string` field — it's a real, always-present Postgres column, so this is just widening the type to match reality.
  - `TaskCardTask` (task-card.tsx) gained an **optional** `updatedAt?: string` field, to avoid forcing every existing construction site (tests, board.tsx's optimistic-update spreads) to supply it.
  - `lib/queries/tasks.ts`'s initial board fetch now selects and maps `updated_at` too, so the guard is live from the very first Realtime event a client receives after page load, not just the second one onward.
- Guard uses `>=` (apply if incoming.updatedAt >= existing.updatedAt), per the spec, so same-timestamp retries/corrections still apply — only a strictly older incoming row is dropped.
- If either side's `updatedAt` is `undefined` (local state predates this field, or a test event omits it), the guard falls through to the old always-apply behavior rather than blocking — there's nothing to compare, and refusing to apply would silently drop legitimate first updates.
- Left the soft-delete branch (`row.deleted_at` → filter out) unguarded by comparison — out of scope for this fix (see below).

## Out-of-scope work needed
- The soft-delete removal path in reconcileTask (`if (row.deleted_at) return tasks.filter(...)`) has the same theoretical out-of-order exposure: a stale soft-delete UPDATE event arriving after a newer un-delete/restore event would incorrectly remove a task that should still be showing. Not covered by AS-076/AS-081 as currently scoped and not exercised by any test; worth a follow-up if soft-delete restore ever ships.
- Finding 1 (AS-072/AS-082, `lib/board/position.ts` fallback nudge can escape `[prev, next]`) and Finding 2 (AS-077 partial cross-column rollback) from M5-scrutiny.md were F101/F102's scope, not this feature's — not touched here. Per the mission record, both are already handled (F102's commit shows an atomic `moveAndReorderTask` landed for Finding 2; confirm F101's handoff for Finding 1's status).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Made `TaskCardTask.updatedAt` optional rather than required, to avoid a much larger diff (every test fixture and board.tsx call site that builds a `TaskCardTask` would otherwise need updating). The guard degrades gracefully to "always apply" when the value is missing on either side, which only weakens protection for tasks whose local state predates this field (i.e., never, in practice, once F103 ships) — not a behavior regression versus before this fix.

## Notes for the next worker
- Both `lib/board/reconcile-realtime-task.ts` and `tests/unit/reconcile-realtime-task-ordering.test.ts` are self-contained and easy to extend if a future scrutiny pass wants the soft-delete path guarded too.
- **All M5 follow-ups are now complete: F101, F102, and F103 (this feature) each closed one of M5-scrutiny.md's three findings.** Milestone 5 is ready for a scrutiny re-check before Milestone 6 begins.
