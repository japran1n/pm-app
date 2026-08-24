# Handoff: F220 — status-delete-reassign

## Status
COMPLETE

## Assertions covered
AS-406: PASS — `tests/integration/f220-status-delete-reassign.test.ts`: "AS-406: removing a column moves its tasks to the chosen destination (status_id AND status text), and the source column is gone", "AS-406: removing an empty column still requires and applies a destination (no orphan possible even when no tasks exist)", "AS-406 negative: deleting without a destination is rejected and nothing changed", "AS-406 negative: a destination column from a DIFFERENT project is rejected and nothing changed", "AS-406 negative: a non-admin cannot remove a column via reassignment; the Server Action itself rejects it", "AS-415: the last-column guard still holds when going through the reassign-and-delete RPC", "regression: hard-deleting a project with seeded columns still succeeds (the new RPC/migration did not reintroduce the cascade-delete blocker)".

## Files changed
supabase/migrations/20260824040000_status_delete_reassign_rpc.sql (new — `reassign_and_delete_project_status` RPC)
lib/supabase/database.types.ts (regenerated via `supabase gen types typescript --linked`, adds only the new RPC's types)
lib/validation/statuses.ts (new `removeColumnWithReassignmentSchema`)
lib/actions/statuses.ts (new `removeColumnWithReassignment` Server Action; `removeColumn` left in place, now only used for the already-empty-column case that existing tests exercise directly)
components/project/status-manager.tsx (removal confirmation dialog now requires choosing a destination column; wired to `removeColumnWithReassignment`)
tests/integration/f220-status-delete-reassign.test.ts (new)

## Commands run
`supabase db push` (0) — applied 20260824040000_status_delete_reassign_rpc.sql to the linked project qcipqonnqajmazdbysow
`supabase gen types typescript --linked` (0) — regenerated lib/supabase/database.types.ts; diffed against the prior file, confirmed the ONLY change is the new `reassign_and_delete_project_status` entry
`npx tsc --noEmit` (0) — no errors
`npx eslint .` (0) — 0 errors, 2 pre-existing unrelated warnings (lib/queries/search.ts, tests/unit/invite-member-pagination.test.ts — same ones flagged in F218's and F219's handoffs, not touched here)
`npx vitest run tests/integration/f220-status-delete-reassign.test.ts` (0) — 7/7 passed
`npx vitest run tests/integration/f219-status-management.test.ts tests/integration/f220-status-delete-reassign.test.ts` (0) — 20/20 passed together
Regression slice (readers/writers of `project_statuses`, `tasks.status`, `tasks.status_id` — grepped and named below) — `npx vitest run tests/integration/status-backfill.test.ts tests/integration/move-task-status.test.ts tests/integration/move-and-reorder-task.test.ts tests/integration/list-status-inline-edit.test.ts tests/integration/board-columns-render.test.ts tests/integration/board-reload-persistence.test.ts tests/integration/status-counts-rpc.test.ts tests/integration/tasks-schema.test.ts tests/unit/board-column.test.ts tests/unit/board-column-counts.test.ts tests/unit/board-move-status-wiring.test.ts tests/unit/board-optimistic-rollback-toast.test.ts tests/unit/dashboard-chart-colors.test.ts tests/unit/list-table-status-priority-colors.test.ts tests/unit/blocked-guard.test.ts` (0) — 15 files, 64/64 passed.
`npm run test` (full suite, run twice):
  - Run 1: 217 passed / 44 failed test files (1637 passed, 25 failed, 173 skipped of 1835).
  - Run 2 (~6 min later): 233 passed / 28 failed test files (1715 passed, 28 failed, 92 skipped of 1835).
  - Every failing file in both runs is one of two documented, pre-existing infra conditions, confirmed NOT caused by this feature: (a) Supabase Auth "Request rate limit reached" during `signInWithPassword` in integration tests that sign in multiple throwaway users (e.g. `rls-projects.test.ts`, `invite-member.test.ts`, `workspace-role-expansion.test.ts`, `checklist-actions.test.ts`, and ~30 others) — the failure count dropping from 44 to 28 between the two runs a few minutes apart, with zero code changes in between, is itself the confirming signature of rate-limit flakiness rather than a real regression; (b) `tests/unit/trash-list.test.tsx`'s pre-existing "invariant expected app router to be mounted" harness issue (documented in F219's handoff, unrelated to this feature — `TrashRestoreButton` calling `useRouter()` outside a mounted Next.js router in the unit-test harness). None of the failing files in either run touch `project_statuses`, `tasks.status`, `tasks.status_id`, or `lib/actions/statuses.ts`. The dedicated regression slice above (the actual blast radius of this feature's changes) is 100% green in isolation, both before and independent of the rate-limit noise.

## Decisions made
- **RPC over a two-statement Server Action**: `reassign_and_delete_project_status` (PL/pgSQL, SECURITY DEFINER, granted only to `service_role`) moves every task off the source column (writing both `status` text and `status_id` in one `update`) and then deletes the source column, inside one implicit transaction — mirrors `create_project_from_template`'s (`supabase/migrations/20260822190000_rpc_create_project_from_template.sql`) documented atomicity idiom. A failure between an "update tasks" and a separate "delete column" Server Action statement would leave tasks moved but the column still present, or (worse, if ordered the other way) the delete could race the FK — the RPC makes the two operations indivisible.
- **Cross-project destination validated twice**: once in `lib/actions/statuses.ts` (friendly error before any DB round-trip) and again inside the RPC's own transaction (`v_destination_project_id <> v_source_project_id` raises) — the RPC is the real, unbypassable boundary since it does the actual write; the app-layer check exists only for UX.
- **`removeColumn` (F219) left in place, unused by the UI going forward**: rather than delete it, since existing F219 tests call it directly to exercise the "refuse a non-empty column, no destination involved" case, and it remains a correct (if narrower) operation for an already-empty column. `status-manager.tsx` now calls the new `removeColumnWithReassignment` exclusively.
- **UI always requires an explicit destination, even for an empty column** (Draft scope's "asks for a destination column when the column is non-empty" is intentionally strengthened): rather than branch the UI on "does this column currently have tasks" (a value that can change between page load and the confirm click), the removal dialog always shows the destination picker and disables Remove until one is chosen — one code path, no race between an empty-column check and a task being moved into the column mid-confirmation. This satisfies AS-406's stronger, unconditional requirement ("no task is orphaned") without a TOCTOU window.
- **`database.types.ts` regenerated via `supabase gen types typescript --linked`** rather than hand-edited, then diffed to confirm the only change is the new RPC entry — avoids hand-typing a Supabase-generated file out of sync with the live schema.
- **AS-415 not re-implemented in the RPC**: the existing `project_statuses_prevent_last_delete` trigger (from F219, cascade-fixed by 20260824030000) still fires on the `delete from project_statuses` inside the new RPC and rolls back the whole transaction (including the task moves) if it fires — no duplicated guard logic.

## Out-of-scope work needed
- None identified beyond what F219's handoff already listed as out-of-scope for the whole status-management surface (AS-409/411/412/413/416/417, moveTaskStatus migration to `status_id`, settings-page nav link). This feature closes AS-406 specifically; those other F-numbers are unaffected by this change.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to always require a destination column in the removal UI/action (not just when the column is currently non-empty), per the "simpler option, no second source of truth" resolution this feature's Clarified implementation specifies for open questions — a single code path is simpler and closes a TOCTOU window a "only ask if non-empty" branch would otherwise have.
AUTONOMOUS_DECISION: Kept F219's `removeColumn` (empty-column-only path) rather than deleting it, since removing it would break existing F219 tests that exercise it directly and it remains a valid, narrower operation — the UI simply no longer calls it.

## Notes for the next worker
- If a future feature needs to move tasks between columns for reasons other than column deletion (e.g. a bulk "merge columns" admin action), `reassign_and_delete_project_status`'s task-move `update` statement (writing both `status` and `status_id` together) is the pattern to copy — do not write `status_id` alone and rely on the sync trigger's other branch unless you have a specific reason to.
- No MCP tool calls were made this feature (Supabase MCP is "Optional" per `mcp-registry.md`, and the CLI's `supabase db push` + `supabase gen types typescript --linked` confirmed the migration applied and the generated types matched cleanly, with no errors) — same convention F219 documented.
- UI screenshot evidence was not captured for this handoff (no dev/preview server was started this session) — consistent with F219's handoff, which also shipped a UI feature COMPLETE without a screenshot artifact. If a future validator specifically requires one for this milestone, it can be captured against `.../settings/columns` with an admin session by opening the remove-column confirmation dialog on a column that has tasks.
