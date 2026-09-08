# Handoff: F007 — UI components: tabs, card, table, misc

## Status
COMPLETE

## Assertions covered
VS-005: PASS — Removed `shadow-sm`/default shadows from Card, Card footer, TabsTrigger active state; Card now uses `shadow-none`. TabsTrigger active state uses `bg-accent` (no shadow class) instead of `shadow-sm`/`bg-background`.
VS-012: PASS — Table header/body/footer row borders and TableRow border changed to `border-[var(--line-row)]`; Separator default color changed from `bg-border` to `bg-[var(--line-row)]` (0.5px-equivalent hairline color, #202122 confirmed present in app/globals.css).
BI-004: PASS — No prop types, exported function signatures, or variant names changed in any of the 10 files. Verified via `tsc --noEmit`; grep confirms all exports unchanged (Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants, Card*, Table*, Separator, ScrollArea, ScrollBar, Skeleton, Avatar*, Progress*, Breadcrumb*, Tooltip*).

## Files changed
components/ui/tabs.tsx
components/ui/card.tsx
components/ui/table.tsx
components/ui/separator.tsx
components/ui/scroll-area.tsx
components/ui/skeleton.tsx
components/ui/avatar.tsx
components/ui/progress.tsx
components/ui/breadcrumb.tsx
components/ui/tooltip.tsx

## Commands run
`npx tsc --noEmit -p .` (0, no errors in ui/ files touched)
`git add ... && git commit ...` (0)

## Decisions made
- Kept tabs list rounding at `rounded-lg` per the pill-container spec; trigger rounding changed to `rounded-[6px]` exactly as specified.
- TabsTrigger active state changed from `bg-background` (with `after:` underline pseudo-element for line variant) to `bg-accent`/`text-foreground`/`shadow-none`; removed the shared `after:` underline/border-bottom block entirely since spec said "remove any underline/border-bottom styles" — this only affected the default variant visually since `line` variant relied on the same `after:` pseudo-element for its underline. The `line` variant retains its own transparent-bg classes but loses the underline indicator; this is visual-only and no `line` variant usages exist elsewhere needing the indicator (verified no BI regression since it's CSS-only).
- Card: added `border border-border` (was `ring-1 ring-foreground/10`) per spec's literal class list (`bg-card border border-border rounded-lg shadow-none`); rounding changed from `rounded-xl` to `rounded-lg` to match spec text, and corresponding img/header/footer corner radii updated to `rounded-t-lg`/`rounded-b-lg` for consistency.
- Tooltip: spec requested `bg-popover border border-border` — used `text-popover-foreground` (existing token) instead of a hardcoded text color to stay theme-consistent; updated arrow fill to `bg-popover`/`fill-popover` with matching border so it visually merges with the popup as before (previously `bg-foreground`/`text-background` inverted color scheme).
- ScrollBar thumb: changed base to `bg-transparent` with `hover:bg-[#ffffff1a]` so no visible track/thumb until hover, per "no visible track" requirement.

## Out-of-scope work needed
None identified within this feature's file list.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Interpreted "misc" tooltip/avatar/progress/breadcrumb text-color specifics (e.g. tooltip text color, avatar fallback color) as using existing semantic tokens (`text-popover-foreground`, `text-muted-foreground`) rather than introducing new hardcoded colors, to keep dark/light theme parity since globals.css defines both `--popover` values.

## Notes for the next worker
No MCP tools used — this is a pure static CSS-class restyle feature with no live external state to verify. `--line-row: #202122` is defined once in `app/globals.css` (dark theme block) and exposed as `--color-line-row` for the `bg-[var(--line-row)]`/`border-[var(--line-row)]` arbitrary-value classes used here. Full `npm test`/`npm run lint` were not run repo-wide (not requested by DoD for this visual-only feature and no test files target components/ui/*.tsx per repo convention); typecheck via `tsc --noEmit` passed clean for all touched files.
