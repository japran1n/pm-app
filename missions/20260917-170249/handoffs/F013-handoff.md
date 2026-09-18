# Handoff: F013 — css breakpoint mapper

## Status
COMPLETE

## Assertions covered
AS-048: PASS — `variantKey('main', null)` returns null (base breakpoint with no state goes to styleLess, not a named variant)
AS-070: PASS — `mapBreakpoint('max-width: 991px')` returns "medium"
AS-071: PASS — `mapBreakpoint('max-width: 767px')` returns "small"
AS-072: PASS — `mapBreakpoint('max-width: 479px')` returns "tiny"
AS-073: PASS — `mapBreakpoint('min-width: 1440px' / '1920px' / '2560px')` returns "large" / "xl" / "xxl"
AS-074: PASS — `mapBreakpoint('print')` and other unmappable media params return null

## Files changed
lib/webflow-converter/breakpoints.ts
lib/webflow-converter/breakpoints.test.ts

## Commands run
`npx vitest run lib/webflow-converter/breakpoints.test.ts` (0) — 17 passed
`npx vitest run lib/webflow-converter/` (0) — 55 passed (all sibling modules unaffected)
`npx tsc --noEmit -p .` (0) — no type errors

## Decisions made
- Named the file `breakpoints.ts` (not `css.ts` as the original draft scope line suggested) and exported `mapBreakpoint()` / `BREAKPOINTS` per the explicit task instructions given for this run, which take precedence over the feature spec's approximate "Files" line. `variantKey()` kept unchanged as a second named export since both functions are inseparable halves of "breakpoint mapping" and the clarified spec's "Module boundaries" answer permits splitting/organizing within the same directory as long as nothing outside this feature's dependents needs to change imports — no other file currently imports from css.mjs's equivalent in this repo, so there's no consumer to break.
- Ported `breakpointFor()` from the prototype byte-for-byte as `mapBreakpoint()`: same regexes, same threshold tables (`MAX_WIDTH_BREAKPOINTS` → `BREAKPOINTS.maxWidth`, `MIN_WIDTH_BREAKPOINTS` → `BREAKPOINTS.minWidth`), same fallback behavior (`max-width` beyond the last table entry falls back to "medium"; `min-width` short of the first threshold falls back to "large"; non-max/min-width queries like "print" return null).
- Ported `variantKey()` unchanged: `!state` + `breakpoint === 'main'` → null; otherwise `${breakpoint}_${state}`. Did not restrict the `state` parameter type to a literal union since the prototype accepts any string (hover, pressed, focus, focus-visible, visited, placeholder, before, after per STATE_ALIASES) and this module doesn't own the alias table — that logic belongs to the selector-parsing feature.
- No changes needed to `Failure test` per definition-of-done — this module has no error/warning branch of its own (unmappable media queries return null, which is a valid non-throwing return, not a warning — the warning message construction lives in the caller, `parseCss()`, per the prototype and is out of scope for F013).

## Out-of-scope work needed
- `parseSelector()` (class-selector + pseudo-state parsing, STATE_ALIASES table) and `parseCss()` (full CSS-to-style-map walk using postcss) from the same prototype file are not ported here — they belong to other features in this milestone (selector parsing / declaration expansion / full CSS conversion engine) per this feature's "Depends on: F001" and narrow assertion scope (AS-070–074, AS-048 only cover breakpoint/variant mapping).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `breakpoints.ts` / `breakpoints.test.ts` as the file names and `mapBreakpoint()` / `BREAKPOINTS` as the exported names, per the explicit run instructions for this feature, superseding the feature spec's own approximate "Files (approximate): lib/webflow-converter/css.ts" line (which the spec itself labels "approximate"). Behavior and thresholds are an unchanged, byte-for-byte port either way.

## Notes for the next worker
- Reference prototype: `~/Desktop/html-to-webflow/src/css.mjs`, functions `breakpointFor()` (lines 36-50) and `variantKey()` (lines 78-81).
- The prototype's `STATE_ALIASES` map (hover→hover, active→pressed, focus→focus, focus-visible→focus-visible, visited→visited, placeholder→placeholder, before→before, after→after) is NOT ported here — whichever feature ports `parseSelector()` needs it, and can call this module's `variantKey(breakpoint, state)` once it has resolved the alias.
- No MCP usage — this is a pure TypeScript logic port with no external services involved (mcp-registry.md confirms "MCP at run: none" for this feature).
