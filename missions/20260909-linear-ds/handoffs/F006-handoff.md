# Handoff: F006 — UI components: overlays (dropdown, popover, dialog, command, sheet)

## Status
COMPLETE

## Assertions covered
VS-005: PASS — All overlay components (dropdown-menu, popover, hover-card, command, select, dialog, sheet, sonner) now use bg-popover (#141516), border border-border, rounded-lg, and the shadow-medium ([0px_4px_24px_rgba(0,0,0,0.18)]) / shadow-high ([0px_7px_32px_rgba(0,0,0,0.35)]) recipe as specified.
BI-004: PASS — No prop signatures, exports, variant names, or logic were changed in any file; only className strings were edited. `tsc --noEmit` shows no new errors introduced by these files.

## Files changed
components/ui/dropdown-menu.tsx
components/ui/popover.tsx
components/ui/hover-card.tsx
components/ui/command.tsx
components/ui/select.tsx
components/ui/dialog.tsx
components/ui/sheet.tsx
components/ui/sonner.tsx

## Commands run
`npx tsc --noEmit -p .` (1, but only pre-existing unrelated failures in tests/unit/docs-markdown-editor-export-import.test.tsx; no errors in any file touched by this feature)
`git commit` (0)

## Decisions made
- Replaced `ring-1 ring-foreground/15` (used as a pseudo-border) with a real `border border-border` per the Linear overlay recipe, since the spec explicitly calls for a 1px border-border and the old ring approach was the pre-migration pattern.
- Dropdown/popover/hover-card/select-content use the shadow-medium recipe (`shadow-[0px_4px_24px_rgba(0,0,0,0.18)]`); command, dialog, sheet use the shadow-high recipe (`shadow-[0px_7px_32px_rgba(0,0,0,0.35)]`), matching the "dropdowns/popovers vs dialogs/sheets" split in the spec.
- Item/row hover states across dropdown-menu, select, and command changed from `focus:bg-accent` to `hover:bg-[#ffffff0d]` / `focus:bg-[#ffffff0d]` (and `data-selected:bg-[#ffffff0d]` for command) per the Linear recipe; radius on items changed to `rounded-[4px]` where the spec called for it (dropdown/command items) — select items kept `rounded-[4px]` too for consistency since spec listed "Items: text-mini hover:bg-[#ffffff0d]" without objecting to radius.
- `DialogTitle` changed from `font-heading text-regular leading-none font-medium` to `title-1 text-foreground leading-none` per spec ("Title: title-1 text-foreground"); verified `title-1` is an existing utility class used elsewhere in the app (app/globals.css, several page.tsx files).
- Sheet border sides (`border-t/r/l/b`) kept their per-side directional classes but got `border-border` appended alongside each so the border color follows the new token instead of the default `border` color, while preserving the existing per-side border logic untouched.
- Sonner: added `bg-card border border-border text-mini` to the existing `toast` className slot (the only styling entry point exposed via `toastOptions.classNames`), left `theme="light"` and CSS variables (`--normal-bg`, etc.) untouched since spec only asked for the described class additions "if configurable via toaster props," and did not ask to change the theme prop.

## Out-of-scope work needed
- `sonner.tsx` still has `theme="light"` hardcoded, which is inconsistent with the dark aesthetic goal of the mission; not touched here since spec F006 only mentioned className styling, not the theme prop. A future feature (or F007) may want to address this if toast colors look wrong against the dark popover/card background.
- Other non-overlay `components/ui/` files (tabs, card, table, etc.) are explicitly out of scope for F006 — covered by F007 per plan.md.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Applied `rounded-[4px]` to select items in addition to dropdown/command items, since the spec text for select.tsx only specified color but the surrounding Linear item-radius convention (4px) used elsewhere in the same recipe made this the consistent choice, and it does not conflict with any explicit instruction.
AUTONOMOUS_DECISION: Kept sonner `theme="light"` as-is (not in scope) rather than guessing a change on a prop not mentioned in the spec.

## Notes for the next worker
No MCP tools used — this is a pure static CSS class change with no live external service state. Verified `tsc --noEmit` runs clean on all 8 touched files (the only failures shown are in an unrelated pre-existing test file). All base-ui/react Popup/Content components in this codebase share the `data-slot` naming convention consistently, so future overlay-recipe changes should stay symmetric across dropdown-menu.tsx, popover.tsx, hover-card.tsx, select.tsx (content), and the shadow-high group (command.tsx, dialog.tsx, sheet.tsx).
