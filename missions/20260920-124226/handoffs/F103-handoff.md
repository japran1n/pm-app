# Handoff: F103 — Real drag test with unmocked DndContext

## Status
COMPLETE

## Assertions covered
AS-064: PASS — `test_AS_064_drag_reorders_rows` drives a real focus + Space (pick up) + ArrowDown (move) + Space (drop) keyboard gesture through dnd-kit's actual `KeyboardSensor`/`SortableContext`/`closestCenter` (no `@dnd-kit/core` or `@dnd-kit/sortable` mocks) and asserts `router.replace` was called with the new `?people=` order. Backed by a DOM-attribute test and a source-scan test that guard `{...listeners}` stays wired to the handle.
AS-065: PASS — `test_AS_065_weekParam_preserved_on_reorder` performs the same real keyboard gesture and asserts the resulting URL contains `week=2026-W39` alongside the reordered `?people=` value.

## Files changed
tests/unit/f035-stacked-reorder.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint . --max-warnings=0` (0)
`npx vitest run tests/unit/f035-stacked-reorder.test.tsx` (0) — 6/6 passed

## Decisions made
- Removed the `vi.mock("@dnd-kit/core", ...)` that intercepted `DndContext`/`onDragEnd` in the F035 version of this file — per spec, the real dnd-kit gesture must drive the test.
- jsdom returns an all-zero `getBoundingClientRect()` for every element, which would make dnd-kit's `sortableKeyboardCoordinates` see every row's rect as identical (`collisionRect.top < rect.top` false for all siblings) and never move. Stubbed `Element.prototype.getBoundingClientRect` (restored in `afterEach`) to return a distinct, stacked rect per `stacked-row-draggable-<userId>` element based on its position in `?people=` order — the same "each row gets a real measured position" fixup real dnd-kit relies on in a browser, done here since jsdom has no layout engine.
- Stubbed a no-op `ResizeObserver` (matching the existing pattern in `people-switcher.test.tsx` et al.) since jsdom has none and dnd-kit's rect tracking depends on it.
- dnd-kit's `KeyboardSensor` attaches its document-level follow-up keydown listener (the one that handles `ArrowDown`/`Space` after pickup) inside a `setTimeout(fn)` fired at pickup time. Added a `flushMacrotask()` helper (`act(async () => await new Promise(r => setTimeout(r, 0)))`) between each `fireEvent.keyDown` call so the listener is actually attached before the next keystroke — without this, `ArrowDown` fires into a void and the drag never moves.
- Kept the two source-scan/DOM-structure tests from the F035 version (`test_AS_064_drag_listeners_wired_to_handle`, the `SortableContext` import/render check) as a fast backstop alongside the real-gesture test — they catch a `{...listeners}` deletion even faster than the full render+keyboard-gesture path, and neither depends on how `handleDragEnd`'s URL is built, so they don't overlap in what they actually falsify.
- Kept the "same position drop is a no-op" assertion but simplified it to "render alone never calls replace" (no drag performed) since the old version invoked the mocked `onDragEnd` directly with `active.id === over.id`, which is no longer available with the real `DndContext`. The `handleDragEnd` early-return branch for `active.id === over.id` is still exercised implicitly by every real gesture that lands back at its own row, but is not separately asserted in this file — see Out-of-scope below.

## Out-of-scope work needed
None identified beyond the note above (a real-gesture test specifically for "drag picked up then dropped in the exact same slot triggers no `replace`" would need a rect layout where ArrowDown-then-ArrowUp round-trips to the origin, or the equivalent left/right no-op; not required by AS-064/AS-065 text and not requested by the spec).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `Element.prototype.getBoundingClientRect` stubbing + a macrotask-flush helper to make the real dnd-kit `KeyboardSensor` gesture actually move rows inside jsdom, since the spec's example snippet (three `fireEvent.keyDown` calls with no waiting) does not account for dnd-kit's `setTimeout`-deferred keydown listener attachment or jsdom's zeroed layout rects. Verified by running the three required mutations (delete `{...listeners}`, remove `sensors={sensors}`, remove `weekParam` from the URL) against the real component and confirming each one fails as specified — see below.

## Notes for the next worker
Mutation testing results (component reverted after each, confirmed via `diff` against a pre-edit backup):
1. Delete `{...listeners}` from the drag handle → 3 of 6 tests FAIL (`test_AS_064_drag_reorders_rows`, `test_AS_065_weekParam_preserved_on_reorder`, and `test_AS_064_drag_listeners_wired_to_handle`). Confirmed MUST FAIL.
2. Remove `sensors={sensors}` from `<DndContext>` → 2 of 6 tests FAIL (`test_AS_064_drag_reorders_rows`, `test_AS_065_weekParam_preserved_on_reorder`) — with no sensors configured, no gesture starts a drag, `router.replace` is never called. Confirmed MUST FAIL.
3. Remove `weekParam` from the `router.replace` URL construction (`if (weekParam) { params.set("week", weekParam); }` deleted) → 1 of 6 tests FAIL (`test_AS_065_weekParam_preserved_on_reorder`); AS-064's test still passes since it only checks `people=`. Confirmed AS-065 MUST FAIL, exactly as the spec requires.

No MCP tools used — this is a pure client-side unit test change, no external service state involved.
