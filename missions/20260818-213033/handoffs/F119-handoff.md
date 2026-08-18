# Handoff: F119 — add shadcn primitives needed by v2

## Status
COMPLETE

## Assertions covered
none (foundation feature — no assertion IDs assigned)

## Files changed
components/ui/alert-dialog.tsx
components/ui/breadcrumb.tsx
components/ui/calendar.tsx
components/ui/checkbox.tsx
components/ui/collapsible.tsx
components/ui/command.tsx
components/ui/hover-card.tsx
components/ui/input-group.tsx
components/ui/popover.tsx
components/ui/progress.tsx
components/ui/radio-group.tsx
components/ui/scroll-area.tsx
components/ui/switch.tsx
components/ui/toggle-group.tsx
components/ui/toggle.tsx
package.json
package-lock.json

## Commands run
`npx shadcn@latest add command popover checkbox switch progress scroll-area collapsible hover-card alert-dialog calendar toggle-group breadcrumb radio-group --dry-run -y` (0) — previewed the file/dependency plan before writing anything
`npx shadcn@latest add command popover checkbox switch progress scroll-area collapsible hover-card alert-dialog calendar toggle-group breadcrumb radio-group -y` (0) — non-interactive, no prompt stall
`npx tsc --noEmit` (0)
`npx eslint .` (0) — 1 pre-existing unrelated warning in `lib/queries/search.ts` (`_titleMatches` unused var, present before this feature), 0 errors
`npm run build` (0) — Next.js production build succeeded
`npm run test` (0) — 96 test files, 504 tests passed (Vitest unit + integration)
`npx playwright test` (0) — 1 passed (`tests/e2e/board-reorder.spec.ts` — AS-150, pre-existing mission-1 coverage, unaffected by this change); no stray dev server this run, webServer booted and tore down cleanly

## Decisions made
- Ran the CLI with `--dry-run -y` first to see the exact file/dependency plan (15 new files, 4 skipped-as-identical, 3 new npm deps) before applying anything, so nothing was written blind.
- Ran `npx shadcn@latest add ... -y` as one non-interactive batch covering exactly the twelve primitives the spec lists (command, popover, checkbox, switch, progress, scroll-area, collapsible, hover-card, alert-dialog, calendar, toggle-group, breadcrumb, radio-group) plus `radio-group`'s own item — no extras requested.
- `button.tsx`, `input.tsx`, `textarea.tsx`, `dialog.tsx` were reported "skip (identical)" by the CLI — the registry's version matched the files already in the repo byte-for-byte, so nothing was overwritten and no existing working component was touched, per the instruction not to modify components that already work.
- Two additional files landed as registry-declared dependencies of requested components, not extra scope: `components/ui/toggle.tsx` (required by `toggle-group.tsx` — `toggleVariants` is imported from it) and `components/ui/input-group.tsx` (required by `command.tsx`'s search-input styling). Both are load-bearing for the components the spec explicitly asked for, so they were kept rather than treated as unrequested additions.
- No hand-adaptation was needed. The project's `components.json` (`"style": "base-nova"`) points the shadcn CLI at a registry that already emits Base UI-flavored code (`@base-ui/react/*` imports) matching `dialog.tsx`/`select.tsx` conventions — every generated primitive that has a headless-UI concept (popover, checkbox, switch, progress, scroll-area, collapsible, hover-card→PreviewCard, alert-dialog, toggle, toggle-group, radio-group) imports from `@base-ui/react/*`, not Radix. Verified with `grep -rl radix components/ui/` → no matches.
- `command.tsx` imports `Command` from the `cmdk` package directly (not `@base-ui/react`) and `calendar.tsx` imports from `react-day-picker` directly — this matches `tech-decisions.md`'s explicit statement that `cmdk` is "primitive-layer independent and works with the Base UI build already installed"; the same reasoning applies to `react-day-picker`, which is also headless and primitive-agnostic. Both compiled cleanly with no Radix dependency pulled in, so no adaptation was required for either.
- New npm dependencies added by the CLI: `cmdk@^1.1.1` and `react-day-picker@^10.0.1`. `date-fns` was already present at `^4.4.0` (tech-decisions.md: "already installed") and was not re-added.
- `components.json` was not modified — the CLI ran against the existing config without needing changes.

## Out-of-scope work needed
None identified. This was a pure primitive-layer addition with no feature usage, exactly as scoped.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept `components/ui/toggle.tsx` and `components/ui/input-group.tsx`, which were not named in the spec's component list, because the shadcn CLI generated them automatically as hard dependencies of `toggle-group` and `command` respectively (registry `registryDependencies`). Removing them would break the two explicitly-requested components. Treated as part of the requested components' closure, not as scope creep.
AUTONOMOUS_DECISION: Did not hand-adapt any file for Base UI compatibility because none was needed — the configured registry (`components.json` style `base-nova`) already targets `@base-ui/react`, and the two components with external headless deps (`command.tsx` → `cmdk`, `calendar.tsx` → `react-day-picker`) were already primitive-agnostic per tech-decisions.md's stated rationale for `cmdk`. Verified by grepping all new files for any `radix` import (none found) and by full `tsc`/`eslint`/`build` passes.

## Notes for the next worker
- All twelve requested primitives are now in `components/ui/`: `command.tsx`, `popover.tsx`, `checkbox.tsx`, `switch.tsx`, `progress.tsx`, `scroll-area.tsx`, `collapsible.tsx`, `hover-card.tsx`, `alert-dialog.tsx`, `calendar.tsx`, `toggle-group.tsx`, `breadcrumb.tsx`, `radio-group.tsx` — plus their two registry-required companions `toggle.tsx` and `input-group.tsx`.
- `hover-card.tsx` is built on `@base-ui/react/preview-card` (Base UI's naming for the hover-card concept), exported as `PreviewCard as PreviewCardPrimitive` internally but the public component names (`HoverCard`, `HoverCardTrigger`, `HoverCardContent`) match shadcn's usual API — check that file if a future feature needs hover-card props, the underlying primitive name differs from what you'd expect.
- `command.tsx` is the one component in this batch not wrapping `@base-ui/react` — it wraps `cmdk` directly, which is what the mission's Cmd+K palette feature (F1xx, AS-459–AS-466) will build on, consistent with tech-decisions.md.
- `calendar.tsx` wraps `react-day-picker` v10 directly (no Base UI primitive equivalent exists for a full month-grid date picker) — this is a deliberate, working exception, not a placeholder; it compiled and built cleanly.
- No MCP tools were used — this feature is pure local file generation, no Supabase/Playwright MCP interaction needed (Playwright was invoked as a CLI test run, not via its MCP server, matching mcp-registry.md's "used by workers writing `.spec.ts` files for e2e assertions" — no new spec files were needed here).
- No stray dev server was present at run time (checked `lsof -iTCP:3000` and `:3100` before running Playwright), so `npx playwright test` ran to completion this time, unlike the port conflict noted in F118's handoff.
