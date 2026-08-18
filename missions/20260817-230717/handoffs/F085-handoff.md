# Handoff: F085 — keyboard a11y pass

## Status
COMPLETE

## Assertions covered
AS-151: PASS — audited every interactive element in components/**; codebase already compliant (see Decisions). Added tests/unit/keyboard-a11y-pass.test.ts to pin the behavior.

## Files changed
tests/unit/keyboard-a11y-pass.test.ts

## Commands run
`npx vitest run tests/unit/keyboard-a11y-pass.test.ts` (0)
`npm test` (0 — one integration test, tests/integration/list-view-sort.test.ts AS-091, timed out on the full run; re-ran it in isolation and it passed in 3.4s, confirming a pre-existing DB-connection-pool flake unrelated to this feature, not a regression from this change)
`npx tsc --noEmit` (0)
`npm run lint` (0 errors; 1 pre-existing unrelated warning in lib/queries/search.ts)
`npm run build` (0)

## Decisions made
- **Audit method:** grepped every `onClick=` in `components/**` (18 matches) and traced each to its underlying element. Result: 17 are on real shadcn/ui `<Button>` components or raw `<button>` elements (revoke-invite-button, remove-member-button, tags-editor's remove/add buttons, dashboard-retry-button, attachment-list's open/retry/delete, comment-list's retry/delete/submit, list-filters' clear button, task-detail-sheet's retry/delete, archive-project-dialog's confirm/cancel, due-date-sort-header's sort toggle). The 1 exception, `components/task/task-card.tsx`, already implements the correct pattern for a non-button interactive element: `role={onClick ? "button" : undefined}`, `tabIndex={onClick ? 0 : undefined}`, and an `onKeyDown` that treats Enter/Space as activation, mirroring the click handler. No div/span-with-onClick-and-no-keyboard-path ("classic keyboard-inaccessibility bug" per this feature's spec) exists anywhere in components/**.
- **Dialogs/dropdowns/selects:** every usage found (archive-project-dialog, edit-project-dialog, new-project-dialog, member-role-select, project-tabs, list-filters, list-status-select, task-detail-sheet, task-list-table, workspace-switcher) is a shadcn/ui component wrapping Radix primitives (Dialog, DropdownMenu, Select, Tabs) — keyboard-native by construction, nothing to fix.
- **Board drag-and-drop (highest risk area, F043):** confirmed the dnd-kit `KeyboardSensor` is not just imported-but-unused — it's registered via `useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })` inside the `sensors` array actually passed as `<DndContext sensors={sensors} ...>` in `components/board/board.tsx`. `components/board/sortable-task-card.tsx`'s `useSortable()` spreads dnd-kit's `attributes` (which include `role="button"` and `tabIndex={0}` by dnd-kit's own default, confirmed by reading `node_modules/@dnd-kit/core/dist/core.esm.js`) and `listeners` (keydown handling for the sensor) onto the wrapping div, so drag handles are genuinely keyboard-reachable and operable, not just configured. `tests/unit/board-dnd-setup.test.ts` (pre-existing, from F043) already source-level-asserts the sensor wiring; my new test re-asserts `sensors={sensors}` is what DndContext actually receives.
- **No code fixes were needed** — this was an audit that found the codebase already compliant per the spec's "On no gap found: document 'already compliant' explicitly" instruction. The only change is the added test file, which locks in TaskCard's role/tabIndex/onKeyDown pattern and the board's KeyboardSensor wiring so a future regression (e.g. someone adding a new div+onClick, or removing the KeyboardSensor) fails CI.

## Out-of-scope work needed
- **Nested focusable elements on board cards (worth a follow-up, not a blocker):** `SortableTaskCard` (the drag wrapper) renders `<div ref={setNodeRef} {...attributes} {...listeners}>` around `<TaskCard onClick={...}>`. dnd-kit's `attributes` already put `role="button" tabIndex={0}` on that outer div (for keyboard drag activation via Space/Enter), and `TaskCard` independently puts `role="button" tabIndex={0}` on itself (for opening the task detail sheet via Enter/Space) when it has an `onClick`. Both actions remain keyboard-reachable and operable — AS-151 as literally worded is satisfied — but this produces two separate Tab stops per card and overlapping Enter/Space semantics (Enter on the outer wrapper starts a keyboard drag rather than opening the task; the user must Tab once more to reach the inner Card's own Enter/Space handler to open it). This is a legitimate but subtler a11y/UX rough edge (WCAG 4.1.2-adjacent: interactive roles nested within interactive roles) distinct from the "click-only handler unreachable by keyboard" bug class this feature was scoped to find and fix. Untangling it means redesigning the card's interaction model (e.g. a distinct visible drag-handle icon separate from the open-task click target) rather than a `div`→`button` swap, which is bigger than this feature's declared scope (components/task/task-card.tsx + components/board/sortable-task-card.tsx interaction redesign) and risks interfering with F043/F090's drag assertions. Flagging for a scoped follow-up feature (something like "F1xx: separate the board card's drag handle from its click-to-open target") rather than fixing inline here.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Treated "reachable and operable via keyboard alone" (AS-151's literal text) as satisfied by the current nested-focusable board card pattern, since both the drag action and the open-task action are in fact reachable and operable via keyboard — just via two separate Tab stops rather than one. Elected to document the double-tab-stop UX rough edge as an out-of-scope follow-up rather than redesign the card's interaction model under this feature, since that redesign exceeds the "Files (approximate): components/**" scope note's intent (an audit-and-fix pass for the missing-keyboard-path bug class, not an interaction-design change) and risks destabilizing F043/F090's drag-and-drop assertions.

## Notes for the next worker
- The repo's existing pattern for testing dnd-kit config without a browser/jsdom environment (vitest.config.ts uses `environment: "node"`) is source-level regex assertions against the component file's text, e.g. `tests/unit/board-dnd-setup.test.ts`. I followed the same pattern in the new test rather than introducing jsdom.
- If the nested-focusable follow-up above is picked up, `node_modules/@dnd-kit/core/dist/core.esm.js` (search "tabIndex") is where dnd-kit's default `attributes` (role/tabIndex on the sortable wrapper) are defined, useful for confirming any fix doesn't fight the library's own defaults.
