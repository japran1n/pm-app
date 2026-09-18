# F070: rewrite mapBreakpoint guard as case-insensitive anchored grammar (blocker AS-048)

**Milestone:** M2 follow-ups round 6
**Depends on:** F066

## Clarified implementation (inherited)

## Follow-up scope (from M2-scrutiny-6.md B-3)

Rewrite `mapBreakpoint` in `lib/webflow-converter/breakpoints.ts` as a whitelist grammar instead of a case-sensitive blacklist.

### The fix

At the very top of `mapBreakpoint`, lowercase and collapse whitespace once:
```typescript
const q = mediaQuery.trim().toLowerCase().replace(/\s+/g, ' ')
```

Then define what is ACCEPTED (not what is rejected):

The ONLY valid forms are:
```
( optional-prefix ) ( width-condition ) ( nothing-else )

optional-prefix: (empty) | "screen and" | "all and" | "only screen and" | "only all and"
width-condition: "(max-width: Npx)" | "(min-width: Npx)"
                 OR "(width <= Npx)" | "(width >= Npx)" [symmetric range form]
```

If the lowercased, whitespace-collapsed query matches this FULL grammar and nothing more, extract the width value and map to a breakpoint.

If it does NOT match (anything extra after stripping the prefix and width condition), return `null`.

This single change closes:
- Uppercase compound queries (`SCREEN AND (MAX-WIDTH:767PX) AND (ORIENTATION:LANDSCAPE)` → null)
- `(MAX-WIDTH:767PX) AND (MONOCHROME)` → null
- `(MAX-WIDTH:991PX) AND (MAX-WIDTH:767PX)` → null  
- `screenand (max-width:991px)` → null (no space between screen and "and")
- All case-sensitivity issues

### Also add: symmetric `(width >= Npx)` / `(width <= Npx)` forms

`(width <= 991px)` → 'medium' (same as max-width:991px)
`(width >= 1440px)` → 'large' (same as min-width:1440px)

### Update tests in breakpoints.test.ts

- Fix the test at line ~72 that asserts the fallthrough path — replace with a case that exercises the GUARD
- Add uppercase variants for every existing negative case
- Add: `SCREEN AND (MAX-WIDTH:767PX)` → 'small' (uppercase accepted after lowercasing)
- Add: `SCREEN AND (MAX-WIDTH:767PX) AND (ORIENTATION:LANDSCAPE)` → null (extra condition rejected)
- Add: `(MAX-WIDTH:767PX) AND (MONOCHROME)` → null
- Add: `screenand (max-width:991px)` → null (malformed prefix)
- Add: `(width <= 991px)` → 'medium'
- Add: `(width >= 1440px)` → 'large'

## Definition of done
- `npx vitest run lib/webflow-converter/` 0 failed
- `npx tsc --noEmit` clean
- `npm run lint` clean
- Handoff to missions/20260917-170249/handoffs/F070-handoff.md
- Commit: "fix(AS-048): rewrite mapBreakpoint as case-insensitive anchored grammar whitelist"
