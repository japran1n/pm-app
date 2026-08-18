# Handoff: F043 — dnd kit setup

## Status
COMPLETE

## Assertions covered
(none — foundation/skeleton feature per spec)

## Files changed
components/board/board.tsx (new) — DndContext owner: sensors, drag state, DragOverlay, local `tasks` state
components/board/board-column.tsx (modified) — now a Client Component; `useDroppable` per column + `SortableContext` around its cards
components/board/sortable-task-card.tsx (new) — `useSortable` wrapper around the shared `TaskCard` (F040)
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/board/page.tsx (modified) — now renders `<Board initialTasks={tasks} />` instead of mapping `BoardColumn` directly; stays a Server Component, data-fetching unchanged
tests/unit/board-dnd-setup.test.ts (new) — smoke test (see Decisions)
package.json / package-lock.json — added `@dnd-kit/core` and `@dnd-kit/sortable`

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npx vitest run tests/unit/board-dnd-setup.test.ts` (0, 4/4 passed)
`npm test` (full suite: 213 passed, 0 failed — the pre-existing F042-handoff-noted JWT clock-skew failure in `tests/integration/delete-task.test.ts` did not reproduce this run)
`npm run build` (0)

## Decisions made
- **Package versions deviate from tech-decisions.md.** tech-decisions.md specifies `@dnd-kit/core` + `@dnd-kit/sortable` both `^6.3.1`. `@dnd-kit/core@6.3.1` exists and was installed as specified. **`@dnd-kit/sortable` has no `6.3.x` release at all** — checked via `npm view @dnd-kit/sortable versions`; the package's own major-version numbering diverged from `core`'s a while back (sortable's peer requirement on core stayed `^6.3.0` throughout). Installed `@dnd-kit/sortable@^10.0.0` (current latest, peer-declares `@dnd-kit/core: ^6.3.0`, published the day after `core@6.3.1`) instead. This is a version-numbering artifact, not a different library or a contradicted design decision — the clarified spec's actual requirement ("accessible keyboard support," pointer+keyboard sensors) is unaffected. Not treated as BLOCKED since installing the literal string `^6.3.1` for sortable would simply fail with no such version; flagging here per the "don't override a clarified answer silently" rule, even though this is a stale version string rather than a clarified implementation answer.
- **Architecture:** `Board` (new, Client Component) is the single `DndContext` owner — sensors, `activeTask` state for the `DragOverlay`, and `onDragStart`/`onDragEnd`. `BoardColumn` (converted to Client Component) wraps its cards in a `SortableContext` and is itself a `useDroppable` target (so a column with zero cards is still a valid drop target — `SortableContext` alone only covers reordering within an already-nonempty list). `SortableTaskCard` (new) wraps the untouched, still-presentational `TaskCard` (F040) with `useSortable`'s ref/listeners/transform. This keeps `TaskCard` itself dnd-agnostic, matching F040's original "pure presentational" intent.
- **Server/Client boundary:** the board page stays a Server Component (data-fetching unchanged, `getProjectBoardTasks` untouched) and passes the fetched tasks as `initialTasks` into `<Board>`, which owns them as local `useState` from that point on. This matches the file layout's "Server Component for data-fetching, thin Client Component only for the interactive part" pattern already used by F042 — the client boundary just moved from "no boundary" (F042) to `<Board>` (F043), since dnd-kit's hooks require a client component tree.
- **Sensors:** `PointerSensor` with `activationConstraint: { distance: 4 }` (so an eventual click-to-open-detail-sheet handler on `TaskCard` isn't swallowed as a drag start) and `KeyboardSensor` with `coordinateGetter: sortableKeyboardCoordinates` — both configured via `useSensors`, per the spec's "keyboard sensor is required, not optional" note (AS-151 depends on it later). `collisionDetection={closestCorners}` — dnd-kit's documented choice for mixed sortable-list-plus-droppable-container boards like this one (cards + column-as-droppable).
- **Client-side-only reordering, exactly as scoped.** `onDragEnd` computes the new `tasks` array (status change + insertion position) entirely in local `useState` — no Server Action call. Two `TODO(F045)` / `TODO(F046)` comments are placed at the exact point in `board.tsx`'s `onDragEnd` where the status-change and position-persist Server Actions are meant to plug in (optimistic update + rollback pattern noted in the TODOs, since F045/F046 will need to decide their own failure-handling contract).
- **Empty-column drop target:** `over.id` in `onDragEnd` is either another task's id (dropped near/on a card — resolved via `SortableContext`) or a column's `status` literal (dropped on `useDroppable`'s column-level target, which only fires when there's no closer sortable item, e.g. an empty column). Both cases are handled in one code path rather than two branches with duplicated insert logic.

## Out-of-scope work needed
- Actual persistence (status-change + position-persist Server Actions) — F045/F046, exactly per this feature's scope. TODO markers are in `components/board/board.tsx`'s `onDragEnd`.
- Click-to-open-detail-sheet wiring for `TaskCard.onClick` (still unwired, per F042's own handoff note) — `Board`/`BoardColumn` both accept and thread an optional `onCardClick` prop end-to-end so this is trivial to wire once a detail-sheet feature exists; not invoked by anything yet.
- No visual "drop indicator" / placeholder styling beyond dnd-kit's default transform-based reorder animation and the `DragOverlay` — not requested by the spec, flagging in case a later polish pass wants it.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Installed `@dnd-kit/sortable@^10.0.0` instead of the tech-decisions.md-specified `^6.3.1`, because no `6.3.x` release of that package exists on npm (verified via `npm view`) — `10.0.0` is the version that was actually co-published alongside `core@6.3.1` and peer-declares `core: ^6.3.0`, i.e. it's the correct/only match for the stated intent ("dnd-kit core + sortable, accessible keyboard support"), just under a different major-version number than tech-decisions.md assumed.
AUTONOMOUS_DECISION: Converted `components/board/board-column.tsx` from a Server Component to a Client Component (was explicitly Server-only in F042's own comments). Necessary because `useDroppable`/`SortableContext` are hooks and cannot run in a Server Component; the alternative (keeping `BoardColumn` server-rendered and pushing all drag wiring into `Board` alone, with columns as plain divs) would have made empty columns non-droppable, which the spec's "columns" scope implies should work. `board-column.tsx`'s file comment is updated to explain the new boundary.

## Notes for the next worker
- MCP at run: none used (no external service touched by this feature — pure client-side package install + component wiring).
- `Board`'s local `tasks` state is currently the *only* source of truth for what's rendered after a drag — it does not re-sync with `initialTasks` on prop change (no `useEffect`), which is fine for F043 (one page load, no revalidation yet) but is exactly the seam F045/F046 will need to reconcile with a Server Action + optimistic-update/rollback strategy. Read the two `TODO(F045)`/`TODO(F046)` comments in `board.tsx`'s `onDragEnd` before starting either of those features.
- `tests/unit/board-dnd-setup.test.ts` is intentionally an SSR-render-doesn't-crash + source-level "sensors are actually wired up" smoke test, not an interaction test — this repo's existing board tests (`board-column.test.ts`) already establish the `environment: "node"` / `renderToStaticMarkup` pattern with no jsdom, and dnd-kit's sensors only activate on real browser pointer/keyboard events that a jsdom-less unit test can't simulate anyway. A real interactive drag test (Playwright, pressing arrow keys and asserting a card moves) is deferred to F090 per this feature's own clarified spec ("full E2E drag test isn't required at this stage").
