# Handoff: F049 — board realtime subscription

## Status
COMPLETE

## Assertions covered
AS-076: PASS — verified via `tests/unit/board-realtime-subscription.test.ts` (subscription configuration + payload forwarding + reconciliation logic) and the applied migration confirming Realtime is enabled at the Postgres level. See "Notes for the next worker" for what true two-client end-to-end delivery coverage would still require.

## Files changed
supabase/migrations/20260818040000_realtime_tasks_publication.sql
components/board/use-board-realtime.ts
lib/board/subscribe-board-realtime.ts
lib/board/reconcile-realtime-task.ts
components/board/board.tsx
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/board/page.tsx
tests/unit/board-realtime-subscription.test.ts
tests/unit/board-dnd-setup.test.ts
tests/unit/board-move-status-wiring.test.ts
tests/unit/board-optimistic-rollback-toast.test.ts

## Commands run
`supabase db push --linked` (0) — applied the Realtime publication migration to the linked project
`npx tsc --noEmit -p .` (0)
`npm run lint` (0)
`npm test` (0) — 47 files / 262 tests passed, includes the new board-realtime-subscription.test.ts
`npm run build` (0)

## Decisions made
- **Realtime was NOT enabled for `tasks`** at the Postgres replication level before this feature — grep of `supabase/migrations/` for `supabase_realtime` found nothing, and `create table` for `tasks` predates this feature. Added `supabase/migrations/20260818040000_realtime_tasks_publication.sql` (`ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks`, guarded by a `pg_publication_tables` existence check so it's idempotent) and applied it via `supabase db push --linked` against the linked project (`qcipqonnqajmazdbysow`). Without this, `postgres_changes` would silently never fire for `tasks` regardless of client-side code correctness.
- **Reconciliation strategy: always trust the incoming server row, no dedup of "was this my own optimistic update."** The clarified task explicitly allowed this ("reconciling with the just-arrived server state is fine and often simpler than trying to dedupe"). Implemented as a pure `reconcileTask(tasks, event)` function (`lib/board/reconcile-realtime-task.ts`) — replace-or-insert by `id` for INSERT/UPDATE, remove by `id` for DELETE or for an UPDATE whose new row has `deleted_at` set (soft delete). Idempotent: an event for a task whose row already matches locally is a no-op diff.
- **Split the hook into a thin `useEffect` wrapper (`components/board/use-board-realtime.ts`) and a plain, React-free `subscribeToBoardRealtime` function (`lib/board/subscribe-board-realtime.ts`).** This repo's vitest config runs with `environment: "node"` and has no React Testing Library, so a hook whose logic only exists inside `useEffect` would be unverifiable in the unit suite. Extracting the channel/subscribe/callback wiring as a plain function let it be unit-tested directly (channel name, table, filter, event types, and callback-forwarding-to-onChange) without a DOM.
- **Channel scoped per-project** (`board:<projectId>`) with a Realtime row filter (`project_id=eq.<projectId>`), matching AS-068's per-project board scoping and discovery round-2 Q2's "tasks + comments" Realtime table choice (this feature covers `tasks` only, per F049's own scope — comments' Realtime subscription is a separate feature, AS-103/AS-101).
- **`Board` now requires a `projectId` prop** (previously only `initialTasks`/`onCardClick`) so the hook can scope its subscription. Updated the board page (`app/.../board/page.tsx`) to pass it, and fixed three pre-existing unit tests (`board-dnd-setup`, `board-move-status-wiring`, `board-optimistic-rollback-toast`) that rendered `<Board>` directly via `createElement` and needed the new required prop added (`projectId: "project-1"`) to keep compiling/passing — no behavioral change to those tests' assertions.
- **No Realtime-specific RLS policy added.** Supabase Realtime's `postgres_changes` respects a table's existing RLS SELECT policy for authenticated clients; `tasks_select_active_members` (already in place) is sufficient — a client only receives events for tasks in projects it's a workspace member of, same as a normal SELECT.

## Out-of-scope work needed
- Comments Realtime subscription (discovery round-2 Q2's second half, AS-103/AS-101) is a separate feature and not touched here — only `tasks` Realtime was in this feature's scope.
- True two-client end-to-end Realtime delivery testing (see below) would be a good fit for a Playwright test with two browser contexts, following the same pattern F090 uses for drag-and-drop, if the team later wants stronger coverage than the unit-level verification done here.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Testing end-to-end Realtime delivery (insert via a second client, assert the first client's live subscription callback fires) was judged impractical to make deterministic in this repo's fast `vitest run --environment node` unit suite — it requires two concurrent WebSocket connections to the real Supabase Realtime server and is inherently timing-dependent. Per the task's own fallback guidance ("a test that at least confirms the subscription is correctly configured... with a clear note in the handoff about what could/couldn't be verified end-to-end"), I wrote `tests/unit/board-realtime-subscription.test.ts` covering: (1) the exact channel name/table/filter/event configuration passed to the Supabase client via a mock `channel().on().subscribe()` chain, (2) that the registered `postgres_changes` callback correctly forwards an arbitrary payload to `onChange` (proving the wiring, not just the config object), and (3) the full `reconcileTask` reducer for INSERT, UPDATE (column/position move), UPDATE-with-soft-delete, and DELETE. True live-delivery coverage (two concurrent connections) is left as a documented gap, suggested above as a Playwright follow-up if the team wants it.

## Notes for the next worker
- The migration is already applied to the linked project (`supabase db push --linked` ran clean, no confirmation needed since this session runs non-interactively via the CLI's default "push these migrations" prompt — it applied without further input).
- If a future feature (e.g. comments Realtime) needs the same "channel scoped by row filter, forward raw payload, reconcile in a pure function" pattern, `lib/board/subscribe-board-realtime.ts` + `lib/board/reconcile-realtime-task.ts` is the template — copy the shape rather than growing `use-board-realtime.ts` into a multi-table hook.
- `RealtimePostgresChangesPayload` and `SupabaseClient` types come from `@supabase/supabase-js` (re-exported from `@supabase/realtime-js`), already a dependency — no new package added.
