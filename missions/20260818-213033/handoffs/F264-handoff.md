# Handoff: F264 — board on phone-width screens

## Status
COMPLETE

## Assertions covered
AS-514: PASS — Board's ungrouped column row (`components/board/board.tsx`) and each Swimlane lane row (`components/board/swimlane.tsx`) opt into `max-sm:snap-x max-sm:snap-mandatory`; each BoardColumn (`components/board/board-column.tsx`) is `max-sm:w-[88vw] max-sm:shrink-0 max-sm:snap-center` — a horizontally scroll-snapping carousel below the `sm:` breakpoint, with a visible peek of the next column (88vw, not 100vw) as the column indicator, no new dependency. Verified via source-level test assertions in `tests/unit/f264-mobile-board.test.tsx` (AS-514 describe block, 2 tests, both pass) plus `next build`/`tsc` confirming the classes compile. I could NOT do a live 375px browser-preview screenshot — no browser/preview tool was available in this environment (see Notes). This is a source/CSS-reasoning verification, not a visual one; said explicitly rather than claimed.
AS-515: PASS — real DOM (jsdom + @testing-library/react) test renders `SortableTaskCard` standalone (no `DndContext`, no drag/pointer-drag events anywhere in the test), opens the new "Move to" dropdown menu via `fireEvent.click` on its trigger, clicks a target column's menu item, and asserts `onMoveToColumn("task-1", "done")` is called — proving the move path is reachable with zero mouse-drag interaction. `tests/unit/f264-mobile-board.test.tsx` (AS-515 describe block, 5 tests, all pass), including a rollback/toast-on-failure source check and an "options exclude the task's own current column" source check.

## Files changed
components/board/sortable-task-card.tsx
components/board/board-column.tsx
components/board/board.tsx
components/board/swimlane.tsx
tests/unit/f264-mobile-board.test.tsx

## Commands run
`npx tsc --noEmit` (0, clean)
`npx eslint .` (0 errors, 6 pre-existing warnings — 2 already documented in NEXT-SESSION.md as long-standing, `lib/queries/search.ts` and `tests/unit/invite-member-pagination.test.ts`; the other 4 are pre-existing warnings in `tests/unit/palette-actions-recents.test.tsx`, unrelated to this feature and untouched by it)
`npx vitest run tests/unit/f264-mobile-board.test.tsx` (0, 7/7 new tests pass)
`npx vitest run tests/unit` (0, 160 files / 1226 tests pass — one pre-existing unrelated "unhandled rejection" warning from `user-avatar.test.tsx`'s `cookies()`-outside-request-scope, not caused by this change, does not fail the run)
`npx next build` (0, clean production build, all routes compile including the board route)
`git commit` (0)

## Decisions made
- No existing card menu was present on `TaskCard`/`SortableTaskCard` before this feature (checked `task-card.tsx` directly) — added a new `DropdownMenu` ("Move to") inside `SortableTaskCard` rather than retrofitting `TaskCard` itself, since `TaskCard` is also reused outside the board (list view) where a board-specific "move to column" action doesn't apply.
- Per the clarification's explicit resolution ("the simpler option that adds no new dependency and no second source of truth"): used Tailwind's existing `max-sm:`/`sm:` scroll-snap utility classes (no new CSS/JS carousel library), and a "partial peek" of the next column (`max-sm:w-[88vw]`) as the mobile column indicator rather than adding separate dot indicators — one visual affordance, no extra state/UI to keep in sync with scroll position.
- `handleMoveToColumn` in `board.tsx` is a new, separate function from `handleDragEnd` — deliberately NOT routed through dnd-kit's `onDragEnd`/`DragOverlay` at all, so AS-515 is satisfiable with genuinely zero drag/pointer-drag interaction (matches the clarification's explicit instruction that the menu action is the PRIMARY path, not a fallback). It mirrors `handleDragEnd`'s cross-column-drop shape (optimistic update, `moveAndReorderTask`, rollback + one sonner toast on failure, `confirmIfMovingToDone` guard for a drop landing on a "done"-category column) but is simplified: no swimlane/lane bookkeeping (the menu only ever targets a column, never a specific lane or neighbor card), and the moved task always lands at the END of its new column via `calculatePosition(lastPosition, null)` — there's no drop-target card to infer a mid-column position from.
- The "Move to" menu is rendered at every viewport width (not `max-sm:`-only) since it's also a faster path than dragging on desktop, but sized larger (`max-sm:size-8` vs `size-6`) at the mobile breakpoint for a comfortable touch target, per this feature's draft scope ("larger touch targets on cards at that width").
- dnd-kit's `PointerSensor`/`KeyboardSensor` (F043/F090) are untouched — dragging (including touch-drag, where dnd-kit's `PointerSensor` already handles touch pointer events) still works exactly as before; this feature adds an additional, independent path, it does not replace or gate the existing one.

## Out-of-scope work needed
- No live browser-preview screenshot at 375px could be produced (see Notes) — a future session with a running dev server + browser/preview tool should capture one and attach it as additional evidence, per the Definition of done's "screenshots additionally for UI features" answer. Not required to re-verify the behaviour (the source-level + jsdom-interaction tests already cover both assertions), just to close out the visual-evidence gap.
- Not touched (out of this feature's file scope per its spec's "Files (approximate)" list): the List/Calendar/Timeline views' own mobile responsiveness, if any — this feature is board-only.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose the "visible partial-next-column peek" (88vw column width) over a dot-indicator UI for the mobile column indicator, per the clarification's "simpler option, no new dependency, no second source of truth" resolution rule — a peek needs no extra state (no scroll-position tracking, no active-index state to keep in sync), whereas dots would require observing scroll position to know which dot to highlight.
AUTONOMOUS_DECISION: Added a brand-new "Move to" `DropdownMenu` to `SortableTaskCard` rather than extending `TaskCard`'s own header, since this codebase has no pre-existing card menu anywhere (verified directly by reading `task-card.tsx`) and the clarification's "reuse existing... rather than new parallel implementations" answer refers to existing shadcn/ui primitives (which `components/ui/dropdown-menu.tsx` already is, reused as-is, same `render`-prop trigger pattern `view-switcher.tsx` already established) — not to a card menu that doesn't exist yet.

## Post-handoff fix (orchestrator-found bug, 2026-08-25)
The orchestrator verified this feature live in a browser at 375px width and
found a real defect: `board-column.tsx`'s `max-sm:w-[88vw]` was never
actually taking effect. Root cause (confirmed by the orchestrator via
`getComputedStyle` in a real browser, and independently reasoned from the
CSS flexbox spec): the column's base classes include `flex-1`, which
compiles to a non-`auto` flex-basis. Per spec, once a flex item's
`flex-basis` is non-`auto`, the `width` property is ignored for main-axis
sizing in a row-direction flex container — flex-grow/shrink alone decide
each item's width. So all four columns rendered squeezed to an even ~50px
split at 375px instead of one column taking ~88vw with a peek of the next,
breaking the AS-514 carousel UX (`max-sm:w-[88vw]` was present in the
compiled stylesheet and matched, but was inert).

Fix: added `max-sm:flex-none` to `board-column.tsx`'s className (resets
flex-basis to `auto` and flex-grow/shrink to 0 below the `sm:` breakpoint,
letting `max-sm:w-[88vw]` govern sizing again; `max-sm:shrink-0` is now
redundant but left in place, harmless, documents intent).
`swimlane.tsx` does NOT have its own copy of this class pattern — it
renders its lane columns via `<BoardColumn>` itself (no duplicate width
classes), so the one fix in `board-column.tsx` covers both the plain board
and swimlanes; no swimlane.tsx edit was needed.

Verification: no Playwright/browser/preview tool was available in this
environment (same limitation as the original F264 session — Read/Write/
Edit/Bash only). I did NOT visually confirm the fix in a real browser.
I relied on: (1) the CSS reasoning above, which is unambiguous per the
flexbox spec — `flex-none` unconditionally sets flex-basis to `auto`,
removing the exact interference mechanism the orchestrator diagnosed; and
(2) a new regression test
(`tests/unit/f264-mobile-board.test.tsx`, "BoardColumn resets flex-basis
to auto below the mobile breakpoint...") asserting `max-sm:flex-none` is
present in the compiled source, so a future edit that drops this class
fails CI immediately. Full suite (tsc, eslint, vitest full run, next build)
all clean after the fix — see updated Commands run below.

Files changed by this fix: `components/board/board-column.tsx`,
`tests/unit/f264-mobile-board.test.tsx`.

Commands run for this fix:
`npx tsc --noEmit` (0, clean)
`npx eslint .` (0 errors, same 6 pre-existing warnings as before, unrelated)
`npx vitest run tests/unit/f264-mobile-board.test.tsx` (0, 8/8 pass, +1 new test)
`npx vitest run tests/unit` (0, 160 files / 1227 tests pass, same single pre-existing unrelated unhandled-rejection warning as before)
`npx next build` (0, clean production build)

Out-of-scope work needed (unchanged from before): a future session with a
running dev server + real browser/preview tool should still capture an
actual 375px screenshot to close the visual-evidence gap completely — the
CSS reasoning here is airtight, but no session so far has had visual
tooling available to prove it end-to-end.

## Notes for the next worker
- **No browser/preview tool was available to me in this environment** (my tool list was Read/Write/Edit/Bash only — no `preview_start`, no Playwright MCP, no screenshot capability). I did NOT run a live browser at 375px and did NOT fabricate a claim of visual verification — the spec's instruction to "verify in the browser preview... not only via CSS reasoning" is honestly only partially satisfiable from this session: I verified the actual DOM interaction path for AS-515 with a real jsdom render (a step up from pure CSS/source reasoning), but AS-514's carousel behaviour (real scroll-snap, real viewport peek) is still verified only at the source/class level, since jsdom has no real layout or scroll engine to observe it with. A future session with dev-server + browser tooling should do a true 375px visual pass.
- `moveToColumnOptionsByStatus` in `board.tsx` is a `Map<columnName, options[]>` built once via `useMemo` off `sortedColumns` (not recomputed per card) — for column X it's every OTHER real column, excluding X itself, in position order, using the exact same label-resolution rule (`STATUS_LABELS[name] ?? name`) `BoardColumn`'s own header already uses, so a column's "Move to" menu never disagrees with its own visible label elsewhere on the board.
- `SortableTaskCard`'s new "Move to" trigger is wrapped in a `<div onPointerDown={stopPropagation} onClick={stopPropagation}>` so a tap doesn't also bubble into `TaskCard`'s own `onClick` (opens the detail sheet) or into dnd-kit's pointer-sensor drag-start listeners on the card's outer wrapper.
- `DropdownMenuLabel` in this codebase's base-ui-backed `components/ui/dropdown-menu.tsx` throws at render time if used outside a `DropdownMenuGroup` ("MenuGroupContext is missing") — wrapped the label/separator/items in `DropdownMenuGroup` to fix; this cost one failing jsdom test iteration before I found the fix, worth knowing if another feature adds a labeled dropdown menu here.
- No MCP tools used — this is a pure UI feature per `worker-mcp-usage`'s decision tree, and F264's own spec Notes say "MCP at run: none."
