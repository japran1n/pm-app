# Handoff: adhoc-status-ui-2 — Status column UI/UX polish (ClickUp-style, wider, solid pill)

## Status
COMPLETE

## Assertions covered
N/A — ad-hoc product-owner UI request, not tied to a validation-contract assertion ID.

## Files changed
components/task/list-status-select.tsx
components/ui/status-badge.tsx
components/ui/select.tsx
components/task/task-list-table.tsx

## Commands run
`npx vitest run tests/unit/f251-inline-edit-permissions-realtime.test.tsx tests/unit/f250-list-inline-edit.test.tsx tests/unit/f251-list-table-realtime.test.tsx tests/unit/list-priority-select-optimistic.test.tsx tests/unit/list-table-bulk-selection.test.tsx tests/unit/list-table-jk-navigation.test.tsx tests/unit/list-table-status-priority-colors.test.ts tests/unit/list-table-subtask-nesting.test.tsx tests/unit/f087-portal-task-list-overdue-icon.test.tsx` (0, 55 tests passed)
`npx tsc --noEmit` (1 — pre-existing failures in tests/unit/f074-request-approval.test.ts, unrelated to any touched file; confirmed zero errors reference list-status-select.tsx, status-badge.tsx, select.tsx, or task-list-table.tsx)
`npx eslint components/task/list-status-select.tsx components/ui/status-badge.tsx components/ui/select.tsx components/task/task-list-table.tsx` (0, no output)
`git commit` (0)

## Decisions made
- Added `variant?: "tint" | "solid"` to `StatusBadge` defaulting to `"tint"` so every existing caller (priority chip, portal statuses, etc.) keeps its current 10%-tint look unchanged; only `list-status-select.tsx`'s editable trigger and its viewer/guest read-only branch pass `variant="solid"`.
- Solid variant computes fill/border via `color-mix(in srgb, <color> 88%, black)` (not a straight use of the raw colour) so the lighter/grey statuses (e.g. `#64748b` Backlog/To Do) still read as a strong-enough dark fill against white text in light mode, per the CLAUDE.md instruction to keep white text but darken via color-mix rather than switching palette. Text colour is `color-mix(in srgb, white 96%, black)` (near-white) rather than pure `#fff` to avoid a hand-written hex literal.
- Solid pill bumped to `text-[10px]` / `px-2 py-[3px]` (vs tint's `text-[9px]` / `px-[5.5px] py-[3px]`) per spec, keeping `uppercase`, `tracking-[0.07em]`, and `truncate`.
- Rather than restyling `SelectTrigger`'s chevron globally, added an opt-in `hideChevronUntilHover` boolean prop. When set, the trigger gets `group/status` and the chevron gets `opacity-0 transition-opacity group-hover/status:opacity-100 group-focus-visible/status:opacity-100 group-data-[state=open]/status:opacity-100` — the icon is never removed from the DOM, and `group-data-[state=open]/status` (reading the trigger's own `data-state` via the `group/status` class on the trigger itself) keeps it visible for the whole time the popup is open. Every other `Select` in the app (priority, task type, etc.) is unaffected since the prop defaults to `false`.
- Widened the trigger to `w-44 min-w-40 max-w-full` (from `w-40`) and dropped `className="w-full"` from the inner `StatusBadge` so the pill hugs its own label instead of stretching into a full-width outlined box; trigger border/background stay `border-transparent bg-transparent` with `hover:border-transparent` as before (unchanged from prior code, just kept).
- Widened the List view's Status column to `w-[180px]` on the `<TableHead>`. `task-list-table.tsx` has no existing colgroup or per-column min-width convention on its other `<TableHead>` cells (only the checkbox column carries `w-10` and the Estimate/Logged columns carry `text-right`), so `w-[180px]` was added directly rather than inventing a new sizing system.
- Left `icon` colour in the solid variant as `color: "inherit"` (inherits the pill's near-white text colour) rather than the raw status colour, since a colour-tinted icon on a colour-matched solid background would have near-zero contrast against its own fill.

## Out-of-scope work needed
- Board view's status display (components/board or board-column header dot) was not touched — the request was specifically about the List view's status column. If the product owner wants the same solid-pill treatment on the board, that's a separate ad-hoc request.
- No automated visual/contrast test was added for the solid-variant light-mode legibility (this was a manual/visual request from the product owner referencing ClickUp screenshots, and CLAUDE.md's UI scope rule treats pure restyling as generally not needing new assertions). If a future worker wants regression coverage, a snapshot or computed-style test asserting `StatusBadge` renders a `color-mix` background when `variant="solid"` would be a reasonable, cheap addition.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `w-[180px]` for the Status column width since the task-list-table.tsx file has no established min-width convention across its other data columns (Priority/Type/Assignee/Due Date all have no width class at all) — `180px` comfortably fits the widened `w-44`/`min-w-40` trigger plus the row's `px-*` cell padding without over-claiming space from neighbouring columns on a typical viewport.
AUTONOMOUS_DECISION: Kept the near-white solid-variant text colour as a `color-mix` expression (`color-mix(in srgb, white 96%, black)`) instead of writing `#ffffff` or a Tailwind `text-white` class, in case a future contributor treats any literal white as a "new hex value" violation of the token rule; functionally this renders as an off-white with slightly muted contrast that still reads clearly against every status's darkened fill.

## Notes for the next worker
- `STATUS_GROUP_ORDER`/`resolveStatusGroup`/icon logic in `lib/board/status-icons.ts` was NOT touched, per instructions.
- `resolveClientBucket` in `components/portal/status-label.ts` was NOT touched.
- The 11-status default set, icons, and groups in `list-status-select.tsx`'s `DEFAULT_STATUS_OPTIONS` were left exactly as they were before this change — only trigger/pill styling changed.
- No MCP tools were used — this is a pure client-side UI/styling change with no external service or live schema involved.
