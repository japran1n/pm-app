# F051: close shorthand escape hatch (AS-069)

**Milestone:** M2 follow-ups
**Estimated worker time:** 30 minutes
**Depends on:** F011

## Assertion IDs covered
- AS-069

## Clarified implementation
(Inherited from F011)

## Follow-up scope (from M2-scrutiny.md — FU-M2-1)
Make `expandDeclaration`'s `default:` branch assert the invariant instead of violating it:
when `isShorthand(prop)` is true and no `case` matched, return `{decls: {}, warning: '...'}` naming the property and telling the user to write longhands, rather than emitting the declaration verbatim. Do the same for the `font` fallback at `longhand.ts:324`.

Then either implement real expanders for `background`, `animation`, `grid-gap` (→ row-gap/column-gap), `grid-template`, `grid-area`, `grid` — or remove them from `SHORTHANDS` and accept that they are warned-and-dropped (latter is simpler and valid for v1).

Add a property-based test that asserts `isShorthand(k)` is false for every key `k` of every base and variant bucket in the result of `parseCss` — a test that fails if the two sets diverge again.

## Definition of done
- No shorthand property ever appears in the output payload (isShorthand(k) === false for all output keys)
- Property-based test in longhand.test.ts verifies this invariant
- font fallback no longer re-emits shorthand verbatim
