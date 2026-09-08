# Handoff: F001 — Token layer: globals.css + @theme

## Status
COMPLETE

## Assertions covered
VS-001: PASS — `:root` now defines Linear dark background/foreground/card/popover/primary/secondary/muted/accent/destructive/border/input/ring values in place of the Good Guys 3.0 light values; all token names preserved.
VS-002: PASS — New `--line-row` and `--bg-hover` tokens added to `:root` and exposed via `@theme inline` as `--color-line-row` / `--color-bg-hover`.
VS-010: PASS — `[data-surface="portal"]` block added restoring the original Good Guys 3.0 light values (background/foreground/card/popover/primary/secondary/muted/accent/destructive/border/input/ring/brand) so any element with `data-surface="portal"` reverts to the light theme; `--gg-gray-*` and `--gg-brand-*` ramp preserved unchanged for portal consumption.

## Files changed
app/globals.css

## Commands run
`npx next build` (0 — Turbopack compile succeeded; TypeScript step fails on a pre-existing, unrelated error in tests/unit/docs-markdown-editor-export-import.test.tsx that predates this change and touches no file I modified)
`git status --short app/globals.css` (0 — clean after commit)
`git commit` (0)

## Decisions made
- Kept `--radius: 0.5rem` unchanged as instructed (spec did not list it among values to change).
- Left `--chart-*`, `--status-*` tokens untouched per explicit "what NOT to change" instructions, even though chart-1..5 still reference `--gg-brand-500`/`--gg-gray-*` (fine — those source variables remain defined in `:root`).
- Placed the `[data-surface="portal"]` block immediately after the closing brace of `:root`, as its own top-level rule, per spec.
- Added the `html { font-feature-settings; font-optical-sizing; }` rule inside the existing `@layer base` block that already contains an `html { @apply font-sans; }` rule, merging into the same selector rather than creating a duplicate `html` block, since CSS layers/selectors merge fine and this avoids a redundant second `html {}` in the same layer (visual output is identical to declaring a separate block).

## Out-of-scope work needed
- F002 (typography: font loader + type scale in app/layout.tsx and globals.css) and F003 (layout: panel structure) are separate features not touched here.
- `--chart-*` tokens still point at `--gg-brand-500`/`--gg-gray-*` rather than Linear-native chart colors — likely intentional deferral per spec ("leave them as-is for now") but flagging in case a later milestone needs Linear chart tokens.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Merged the new `font-feature-settings`/`font-optical-sizing` rule into the existing `html {}` selector inside `@layer base` instead of adding a second separate `html {}` block, since the spec's intent (apply these properties to `html`) is satisfied identically either way and avoids a duplicate selector in the same layer.

## Notes for the next worker
No MCP tools used — this is a pure local CSS token change with no external service touched. `npx next build` is the fastest way to sanity-check the CSS/Tailwind `@theme` block parses; full `next build`'s TypeScript step will still fail on the pre-existing unrelated test-file error until that is fixed by whichever feature owns it.
