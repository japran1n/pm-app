# F066: restore screen-prefixed media query support (blocker, AS-048)

**Milestone:** M2 follow-ups
**Depends on:** F064

## Context
F064 over-corrected: it rejected ALL media types including "screen" and "only screen" which are the dominant real-world forms. `screen and (max-width:991px)` now returns null and is skipped, which breaks every real-world responsive stylesheet.

## Fix in lib/webflow-converter/breakpoints.ts

Replace the current media-type rejection logic with a stripping approach:

1. Strip known screen-equivalent prefixes BEFORE evaluating the width:
   ```
   // Strip "screen and", "all and", "only screen and", "only all and" (case-insensitive)
   let condition = q.trim()
   condition = condition.replace(/^(?:only\s+)?(?:screen|all)\s+and\s*/i, '')
   ```

2. Keep rejecting non-screen types that slipped through:
   ```
   if (/\b(?:print|tv|speech|handheld|projection|braille|embossed|tty)\b/i.test(condition)) return null
   ```

3. After stripping, apply the same width-only check as before (anchored pure width condition).

4. Replace the whitelist approach for what's allowed after stripping:
   - Only a bare `(max-width: Npx)`, `(min-width: Npx)`, or width range passes
   - Anything with additional `and` conditions after stripping → null

5. In breakpoints.test.ts, fix the test at line ~47 that currently asserts `screen and (max-width:991px)` → null. INVERT it to assert → 'medium'.

Add tests:
- `mapBreakpoint('screen and (max-width:991px)')` → `'medium'`
- `mapBreakpoint('screen and (max-width:767px)')` → `'small'`
- `mapBreakpoint('only screen and (max-width:767px)')` → `'small'`
- `mapBreakpoint('all and (max-width:991px)')` → `'medium'`
- `mapBreakpoint('print and (max-width:767px)')` → `null` (still rejected)
- `mapBreakpoint('tv and (max-width:479px)')` → `null` (still rejected)
- `mapBreakpoint('screen and (orientation:landscape)')` → `null` (non-width feature)

Also add an end-to-end parseCss test:
- `parseCss('@media screen and (max-width:991px){.a{color:red}}')` → a.variants.medium has color:'red'

Run: npx vitest run lib/webflow-converter/breakpoints.test.ts
Run: npx vitest run lib/webflow-converter/ (all 4 files)
Run: npx tsc --noEmit
Run: npm run lint

Write handoff to: missions/20260917-170249/handoffs/F066-handoff.md
Commit: "fix(AS-048): strip screen/all media type prefix before width evaluation"
