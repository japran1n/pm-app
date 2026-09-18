# F061: compound/negated media query parsing (major, AS-048)

**Milestone:** M2 follow-ups
**Estimated worker time:** 25 minutes
**Depends on:** F052

## Assertion IDs covered
- AS-048

## Clarified implementation
(Inherited from F013)

## Follow-up scope (from M2-scrutiny-3.md — FU-M2-18)
Replace the first-match regex scrape in `mapBreakpoint` (lib/webflow-converter/breakpoints.ts)
with a proper condition parser that:

1. **Rejects compound queries** (two or more conditions joined by `and`):
   `(min-width:768px) and (max-width:991px)` → return `null` with a warning
   "compound media query not supported — styles skipped"

2. **Rejects negated queries**: queries containing `not ` → return `null` with warning
   "negated media query not supported — styles skipped"

3. **Rejects `only` prefix**: queries like `only screen and ...` → return `null` with warning

4. **Rejects zero-padded values**: `0991px` → return `null` (don't parseFloat it)

5. **Recognises range syntax**: `(width <= 767px)`, `(width < 768px)` → map the
   pixel value to the correct Webflow breakpoint the same way max-width does.
   `(width > 767px)` / `(width >= 768px)` → map like min-width.

6. **Handles comma-separated query lists**: `@media screen, print { ... }` →
   return `null` with warning "comma-separated media query not supported"

Add tests in `lib/webflow-converter/breakpoints.test.ts`:
- `(min-width:768px) and (max-width:991px)` → `null`
- `not all and (max-width:767px)` → `null`
- `only screen and (max-width:767px)` → `null`
- `screen, print` → `null`
- `(width <= 767px)` → `'small'`
- `(width < 768px)` → `'small'`

## Definition of done
- All compound/negated queries return `null` (not mis-mapped)
- Range syntax maps correctly
- New tests added and passing
- Existing single-condition tests still pass
- tsc and lint clean
