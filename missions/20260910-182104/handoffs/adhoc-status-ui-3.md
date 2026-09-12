# Handoff: Ad-hoc — List view Status cell, revision 3

Supersedes `missions/20260910-182104/handoffs/adhoc-status-ui-2.md` (commits
97537ded + a3d2ca92). That revision's solid ClickUp-style pill trigger was
rejected by the product owner. This is not a mission feature and has no
validation-contract assertion.

## Status
COMPLETE

## Assertions covered
N/A — ad-hoc UI request, no validation-contract assertion ID assigned.

## Files changed
components/task/list-status-select.tsx
components/ui/status-badge.tsx
components/ui/select.tsx
components/task/task-list-table.tsx

## Commands run
`npx vitest run tests/unit/f251-inline-edit-permissions-realtime.test.tsx tests/unit/f003-task-detail-sheet-status-optimistic.test.tsx tests/unit/f250-list-inline-edit.test.tsx tests/unit/f251-list-table-realtime.test.tsx tests/unit/list-table-status-priority-colors.test.ts tests/unit/list-priority-select-optimistic.test.tsx` (0 — 6 files / 31 tests passed; 4 unrelated pre-existing unhandled-rejection warnings from `custom-fields-section.tsx`'s `cookies()` call outside request scope, present before this change too, unrelated to Status cell)
`npx vitest run tests/unit/f251-inline-edit-permissions-realtime.test.tsx tests/unit/f087-portal-task-list-overdue-icon.test.tsx tests/unit/f250-list-inline-edit.test.tsx tests/unit/f251-list-table-realtime.test.tsx tests/unit/f325-board-toolbar-groupby-none.test.tsx tests/unit/list-due-date-cell-optimistic.test.tsx tests/unit/list-page-single-primary-add-task-entry.test.ts tests/unit/list-priority-select-optimistic.test.tsx tests/unit/list-table-bulk-selection.test.tsx tests/unit/list-table-jk-navigation.test.tsx tests/unit/list-table-status-priority-colors.test.ts tests/unit/list-table-subtask-nesting.test.tsx tests/unit/list-view-empty-state.test.ts tests/unit/member-role-select-render.test.tsx` (0 — 14 files / 59 tests passed)
`npx tsc --noEmit` (pre-existing failures only, in `tests/unit/f074-request-approval.test.ts`, unrelated to any file touched here — verified none of the 4 touched files appear in the error output)
`npx eslint components/task/list-status-select.tsx components/ui/status-badge.tsx components/ui/select.tsx components/task/task-list-table.tsx` (0)

## Decisions made
- Matched Priority/Type's exact trigger anatomy: `SelectTrigger size="sm"` box, plain `text-sm` sentence-case label, always-visible chevron, `<SelectValue>` wrapping a `<span className="flex items-center gap-1.5 overflow-hidden">`. Chose `w-40` (not `w-32` like Priority/Type) because "Awaiting Client" (the longest label) truncated at `w-32` — this is the one deliberate width difference the request explicitly allowed ("pick a width in that family that fits").
- Coloured the trigger via inline `style` (`borderColor`/`backgroundColor`/`color` set to the status colour and a `color-mix` derived tint) passed straight to `SelectTrigger`, since `SelectTrigger` already forwards arbitrary props to the underlying `SelectPrimitive.Trigger`, requiring no new prop on the shared component.
- Used `color-mix(in srgb, <color> 12%, transparent)` for the fill — the midpoint of the requested 10-15% range — for both light and dark themes rather than per-theme values, since the status colours themselves (e.g. `#64748b`) are already OKLCH-independent literals; verified by inspection that a full-opacity `#64748b` stroke plus a 12% fill reads as a clearly visible outlined box against both `--field`/`--background` values.
- Deleted `hideChevronUntilHover` entirely from `components/ui/select.tsx` after confirming (via repo-wide grep) that `ListStatusSelect` was its only caller — no dead API left behind.
- Reverted `StatusBadge`'s `variant` prop entirely (not just stopped passing `variant="solid"`) after confirming grep showed no remaining caller passing `variant="solid"` or `variant="tint"` explicitly — `components/task/list-priority-select.tsx`, `components/projects/project-health-badge.tsx`, and `components/task/task-card.tsx` all call it with the pre-change 2-3 prop shape, so `status-badge.tsx` is now byte-for-byte the pre-ad-hoc-2 version except this file's own history.
- Introduced a small module-scope `StatusIconGlyph` wrapper component in `list-status-select.tsx` instead of rendering `statusIconFor(...)`'s return value directly as a JSX tag inline. `statusIconFor` is a plain lookup returning a stable, already-existing lucide icon component, but assigning its result to a PascalCase variable and using it as a JSX tag directly tripped `eslint`'s `react-hooks/static-components` rule (false positive on a lookup, not an actual per-render component creation). Wrapping it as a prop into a small stable component sidesteps the false positive without changing behaviour; the icon itself, its size (`size-3.5`), and its colour-tinting are all unchanged from before this revision.
- Left the dropdown list (`SelectContent`/`SelectItem`, groups, section headers, per-item icons) completely untouched, per the request.
- Changed the Status `<TableHead>` from a fixed `w-[180px]` to no explicit width (matching Priority's and Type's headers, which have none), since the new `w-40` box no longer needs the wider column the old pill-hugging layout required.

## Out-of-scope work needed
None identified — this was a self-contained visual revision confined to the Status cell's trigger/read-only rendering and the two now-dead APIs it left behind.

## Blockers
None.

## Autonomous decisions
AUTONOMOUS_DECISION: picked `w-40` over the suggested example verbatim, confirmed by checking that "Awaiting Client" (16 characters, the longest of the 11 status labels) fits inside a `w-40` (160px) box at `text-sm` alongside a `size-3.5` icon and the trigger's own `pl-3 pr-2` padding, without truncation — matches the request's own suggested value.
AUTONOMOUS_DECISION: used `color-mix(in srgb, <color> 12%, transparent)` (a single fixed percentage) rather than separate light/dark-theme percentages, since the request said to "tune between 10-15% so it works in both themes" (singular target), and the status colour literals are theme-independent hex values already used unchanged by both themes elsewhere in this file (`DEFAULT_STATUS_OPTIONS`).

## Notes for the next worker
- The coloured box's `style` prop is applied directly on `SelectTrigger` (which is `SelectPrimitive.Trigger` under the hood) — if a future revision wants the border/background colouring to survive `SelectTrigger`'s own `hover:border-border-control-hover` and `aria-expanded:border-border-control-hover` Tailwind states without being visually overridden, check the CSS specificity: those are class-based, this is inline `style`, so inline wins today, which is what "coloured stroke, not the default grey" requires — don't add a `!important` override or reorder without re-verifying hover/open states still look colour-correct.
- `StatusIconGlyph` (top of `list-status-select.tsx`) is a small, file-local component — not exported, not meant to be reused elsewhere. If another cell wants the same "coloured lucide icon" rendering, it's a two-line copy, not worth extracting yet.
- No MCP tools were used — this is pure client-side UI, no live schema/service state involved.
