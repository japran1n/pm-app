# F064: reject media type + condition combos in mapBreakpoint (AS-048)

**Milestone:** M2 follow-ups  
**Estimated worker time:** 20 minutes
**Depends on:** F061

## Assertion IDs covered
- AS-048

## Fix needed in lib/webflow-converter/breakpoints.ts

The current mapBreakpoint rejects compound min+max queries but still maps:
- `print and (max-width:767px)` → `small` (print-only style becomes mobile)
- `tv and (max-width:479px)` → `tiny`
- `(max-width:767px) and (orientation:landscape)` → `small`

Fix: reject any media query that contains a media TYPE (`print`, `screen`, `tv`, `all`, etc.) combined with a condition, OR contains any non-width feature (`orientation`, `resolution`, `hover`, `pointer`, etc.).

Simple heuristic: if the query contains `and` AND has any non-(min/max)-width condition, return null.

```typescript
// After existing rejections (comma, not, only, min+max compound):

// Reject any compound with a media type (e.g. "print and (max-width:767px)")
// Check if it has a media type keyword before a condition
const mediaTypePattern = /^(?:all|print|screen|tv|speech|handheld|projection|braille|embossed|tty)\b/i
if (mediaTypePattern.test(q.trim())) return null

// Reject any compound with non-width features (orientation, resolution, hover, etc.)
// If it has "and" but the condition is not purely (max-width:Npx) or (min-width:Npx) or range width
const hasAndKeyword = /\band\b/.test(q)
const isWidthOnly = /^\s*\(\s*(?:max|min)-width\s*:\s*\d+px\s*\)\s*$/.test(q) ||
                    /^\s*\(\s*width\s*[<>=]+\s*\d+px\s*\)\s*$/.test(q)
if (hasAndKeyword && !isWidthOnly) return null
// Also reject a single non-width condition
if (!hasAndKeyword && !/(?:max|min)-width|width\s*[<>=]/.test(q)) return null
```

Add tests in breakpoints.test.ts:
- `'print and (max-width:767px)'` → `null`
- `'tv and (max-width:479px)'` → `null`  
- `'(max-width:767px) and (orientation:landscape)'` → `null`
- `'screen and (max-width:991px)'` → `null`
- `'(max-width:767px)'` → `'small'` (still works)
- `'(max-width:991px)'` → `'medium'` (still works)

Also fix mislabeled AS-048 tests in breakpoints.test.ts:
- Tests at lines ~74,78 that assert POSITIVE mappings (existing max-width values) are labeled AS-048
- These should be labeled AS-070, AS-071, or AS-072 (the exact-width assertions) not AS-048

Run: npx vitest run lib/webflow-converter/breakpoints.test.ts
Run: npx tsc --noEmit
Run: npm run lint

Write handoff to: missions/20260917-170249/handoffs/F064-handoff.md
Commit: "fix(AS-048): reject media-type and non-width-feature compound queries"
