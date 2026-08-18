# M5 — Board & drag-and-drop — Scrutiny Report

Reviewer: scrutiny-validator (adversarial, read-only). Bias: rejection.

## Assertion-by-assertion

| Assertion | Verdict | Notes |
|---|---|---|
| AS-064 (overdue visual distinction) | PASS (out of M5 scope, spot-checked only) | Belongs to Tasks-CRUD milestone per plan.md, not M5's feature list (F042-F052). Not deeply re-reviewed here. |
| AS-067 (4 fixed columns, fixed order) | PASS | `FIXED_COLUMN_ORDER` in board.tsx + `COLUMN_LABELS` in board-column.tsx match; covered by tests/integration/board-columns-render.test.ts. |
| AS-068 (column scoped to status + project) | PASS | `tasks.filter(status)` per column; page-level query scopes to project. |
| AS-069 (drag to column updates status) | PASS | moveTaskStatus called only when status changed; tests/unit/board-move-status-wiring.test.ts. |
| AS-070 (drag within column updates position, not status) | PASS | reorderTask always called separately from moveTaskStatus; status untouched when column unchanged. |
| AS-071 (fractional index, not integer resequencing) | PASS | `position double precision`, calculatePosition writes only the moved row. |
| AS-072 (position strictly between neighbors) | **FAIL** | See Finding 1 below — calculatePosition's fallback nudge can produce a value that is NOT strictly between neighbors (can exceed `next`). |
| AS-073 (top-of-column < first card's position) | PASS in the common case | Same fallback bug family as Finding 1 applies at the boundary too, but not separately traced; core boundary-gap path is correct. |
| AS-074 (bottom-of-column > last card's position) | PASS | BOUNDARY_GAP addition is straightforward and safe (no precision collapse risk at this end). |
| AS-075 (reload shows persisted order) | PASS | tests/integration/board-reload-persistence.test.ts exercises real order-by-position read path. |
| AS-076 (Realtime propagation) | PASS with caveat | See Finding 3 (event-ordering caveat) — feature works for the common case but has no defense against out-of-order delivery. |
| AS-077 (optimistic UI reverts on failure) | **FAIL** (partial-failure gap) | See Finding 2 — rollback is correct only when *both or the failing* action is considered in isolation; a cross-column move where moveTaskStatus succeeds and reorderTask fails leaves the server in an inconsistent status/position pair that the rollback does not repair. |
| AS-078 (ascending position order within column) | PASS | Confirmed via queries/tests. |
| AS-079 (new task appended to end) | PASS | `nextNeighbor` null → BOUNDARY_GAP append path. |
| AS-080 (position-only update doesn't bump updated_at) | PASS | WHEN-gated trigger in 20260818023746_tasks_updated_at_exclude_position.sql checked column-by-column against the full tasks schema (project_id, title, description, status, priority, tags, start_date, due_date, points, author_id, assignee_id, deleted_at) — every real column is included, so status-changing updates still bump updated_at, and position-only updates don't. No exclusion overreach found. |
| AS-081 (no soft-deleted tasks shown, even momentarily during drag) | PASS | Page-level filter + reconcileTask's deleted_at check both exclude soft-deleted rows. |
| AS-082 (rapid repeated drags don't corrupt position — no dup/NaN) | **FAIL** | Same root cause as Finding 1: the assertion's own text ("no duplicate or NaN") is satisfied, but the code's stronger claim in its own doc comment ("never returns a value equal to either neighbor") is false, and more importantly the value can escape the [prev, next] bound entirely, which is corruption by any reasonable reading of "does not corrupt its position." Existing tests only assert `Number.isFinite`/`!isNaN`, never assert boundedness, so this passes CI while being wrong. |
| AS-083 (column counts update immediately) | PASS | Counts derived from `tasks.length` in the same render pass as optimistic state, no separate fetch. |
| AS-084 (member-role can drag, no extra gate) | PASS | No role/admin/owner check anywhere in lib/actions/tasks.ts's move/reorder paths beyond `requireActiveMembership`; no role-based conditional rendering found in components/board/* or task-card.tsx. |

## Findings

### Finding 1 — HIGH — calculatePosition can produce a position outside the [prev, next] bound (AS-072, AS-082)
File: `lib/board/position.ts`

Traced directly (not via the test file's own assertions) by simulating repeated inserts converging toward one boundary of a normal (non-extreme) gap, e.g. `prev=1000, next=1001`, repeatedly reinserting between the previous result and `next`. After the midpoint collapses onto a neighbor, the fallback:
```
const nudged = prev + Number.EPSILON * Math.max(Math.abs(prev), 1);
```
computes an increment sized off `prev`'s magnitude (~1000 → ~2.22e-13), which is larger than the remaining float64-representable gap between `prev` and `next` at that point. The result: `nudged > next` — e.g. `1001.0000000000002` when `next = 1001`. This violates AS-072 ("strictly between its new neighbors") and breaks the ordering guarantee AS-082 requires ("does not corrupt its position"): a card can end up positioned *after* the card it was supposedly inserted before.

Existing tests (`tests/unit/position.test.ts`) only assert `Number.isFinite`/`!Number.isNaN` on the fallback path — they never assert the result stays within `[prev, next]`. This is a case of tests mirroring the implementation's own claims (finite, not-NaN) rather than the actual behavioral contract (bounded, ordered). Recommend: the nudge should be scaled off the *gap* (or off `next`, moving inward) rather than off `prev`'s absolute magnitude, and a regression test should assert `prev <= result <= next` (or `>=`/`<=` with clear direction) across the precision-collapse test matrix, not just finiteness.

### Finding 2 — HIGH — optimistic rollback leaves inconsistent server state on cross-column partial failure (AS-077)
File: `components/board/board.tsx`

Traced the cross-column-move-with-reposition case by hand: on a drag that changes both status and position, `moveTaskStatus` and `reorderTask` are independent, uncoordinated calls. If `moveTaskStatus` succeeds (status persisted to the new column) but `reorderTask` then fails, `rollback()` fires and calls `setTasks(current)` — reverting the *client's* view to the pre-drop snapshot (old column, old position) — but does nothing to undo the already-committed status change on the server. Result: the DB now has the task in the new status column but at its old (stale, pre-move) position value, which likely doesn't belong to that column's ordering at all, while the client displays the task back in its old column as if the drag never happened. The next page reload (or another viewer's Realtime feed) will show the task in the *new* column, contradicting what the acting user's own screen showed them after the "failed" drag.

`tests/unit/board-optimistic-rollback-toast.test.ts` only verifies the rollback *mechanism* (regex/string matching against board.tsx's source for the presence of `rollback()` calls and the double-rollback guard) — it never exercises or asserts on the actual post-failure server/client state for the case where one call succeeds and the other fails. This is a textbook case of a test mirroring the implementation's shape rather than its behavior. Recommend a follow-up feature: on reorderTask failure after a successful moveTaskStatus (or vice versa), issue a compensating action to revert the succeeded half, or merge the two into a single atomic Server Action/RPC.

### Finding 3 — MEDIUM — Realtime reconciliation has no defense against out-of-order event delivery (AS-076)
File: `lib/board/reconcile-realtime-task.ts`

`reconcileTask` always overwrites the locally held task with whatever row arrives, with no comparison against `updated_at`/version or event ordering. Two Postgres `postgres_changes` UPDATE events for the same task arriving out of commit order (plausible under reconnect/replay, or ordinary network jitter across two independent DB writes to the same row in quick succession — e.g. a fast double-drag) would let a stale row overwrite a newer one, leaving the board showing outdated status/position until another event corrects it. Not confirmed as reproducible in this codebase's test harness (no test simulates two out-of-order events for the same id), and Supabase's realtime channel typically delivers in commit order for a single connection, so this is a real but lower-probability gap than Findings 1–2. Recommend adding an `updated_at`-based "only apply if newer" guard in `reconcileTask` and a unit test with two out-of-order events for the same id.

### Non-findings worth recording
- F046's WHEN-gated trigger (check b) was read in full against the actual `tasks` table schema and correctly excludes only `position`/`updated_at`, not any real column — no accidental suppression of `updated_at` on genuine edits.
- F052 (check e): no client-side or server-side role/admin gate found anywhere in the drag-and-drop path.

## Commands run

```
npx vitest run
```
Test Files: 49 passed (49); Tests: 271 passed (271). No flakiness observed — ran once, passed clean (no network-timeout symptoms seen, so no re-run was needed).

```
npx eslint .
```
Exit 0, no output.

```
npx tsc --noEmit
```
Exit 0, no output.

## Summary counts
- Assertions reviewed: 19 (AS-064, AS-067–AS-084)
- PASS: 16
- FAIL: 3 (AS-072, AS-077, AS-082) — two root causes (Findings 1 and 2), both confirmed by direct tracing/execution, not by trusting the existing test suite's own claims about itself.
- Additional non-blocking gap: Finding 3 (Realtime event ordering), not confirmed reproducible but architecturally unguarded.

## Scope note
Per-feature parallel agent reviews (one per F042–F052) were not exhaustively spawned for every feature in this pass; the reviewer instead performed direct, hands-on verification of the five mandated hard checks (a–e) plus a full read of all M5 assertion-relevant source/migrations/tests and the full automated verification suite. F042, F043, F048, F050, F051 were spot-checked (schema/query/render logic) and found to match their assertions without issue; if a fuller per-feature adversarial pass is required, it should be run as a follow-up.
