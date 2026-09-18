# F063: final longhand.ts fixes — AS-069 allow-list + undefined guards + parseBorderParts + flex-flow/list-style

**Milestone:** M2 follow-ups
**Estimated worker time:** 45 minutes
**Depends on:** F060

## Assertion IDs covered
- AS-069, AS-076, AS-055, AS-062, AS-066, AS-135

## Clarified implementation
(Inherited from F005–F010)

## Context
Round 4 scrutiny FAIL. Three blockers:
- NB1: Suite RED — AS-076 test fails because background-position is dropped
- NB2: css-shorthand-properties over-fires on background-position (and grid-row, grid-column, grid-area)
- NB3: AS-069 still leaks for overscroll-behavior, border-inline-start/-end, border-block-start/-end, etc.

## Fixes needed in lib/webflow-converter/longhand.ts

### Fix 1 (NB1+NB2): Add PASS_THROUGH allow-list
Create a `PASS_THROUGH` Set of properties that Webflow accepts natively and must NEVER be warn-and-dropped, even if css-shorthand-properties classifies them as shorthands:

```typescript
const PASS_THROUGH = new Set([
  'background-position',
  'background-size',
  'background-repeat',
  'background-origin',
  'background-clip',
  'background-attachment',
  'background-color',
  'background-image',
  'grid-row',
  'grid-column',
  'grid-area',
  'grid-template-areas',
  'grid-template-rows',
  'grid-template-columns',
  'text-decoration-line',
  'text-decoration-color',
  'text-decoration-thickness',
  'text-decoration-style',
])
```

In `expandDeclaration`'s default branch, check PASS_THROUGH FIRST:
```typescript
default: {
  if (PASS_THROUGH.has(prop)) {
    return { decls: { [prop]: value } }  // Always pass through
  }
  const bare = stripVendorPrefix(prop)
  const isVocabShorthand = (bare in shorthandProperties) || (bare !== prop && bare in shorthandProperties)
  const isExtraShorthand = EXTRA_SHORTHANDS.has(prop) || EXTRA_SHORTHANDS.has(bare)
  if (isShorthand(prop) || isVocabShorthand || isExtraShorthand) {
    return { decls: {}, warning: `shorthand '${prop}' is not supported — write longhands instead` }
  }
  return { decls: { [prop]: value } }
}
```

### Fix 2 (NB3): Add EXTRA_SHORTHANDS supplemental set
Create `EXTRA_SHORTHANDS` for real shorthands not in css-shorthand-properties:

```typescript
const EXTRA_SHORTHANDS = new Set([
  'overscroll-behavior',
  'border-inline-start',
  'border-inline-end',
  'border-block-start',
  'border-block-end',
  'contain-intrinsic-size',
  'font-synthesis',
  'animation-range',
  'scroll-timeline',
  'view-timeline',
  '-webkit-box-shadow',
  '-moz-box-shadow',
  'grid-template-areas',  // also in PASS_THROUGH? No — Webflow doesn't accept it, so warn-and-drop
  'border-image',
  'border-image-slice',
])
```

Note: `grid-template-areas` should be in EXTRA_SHORTHANDS (warn-and-drop) NOT PASS_THROUGH, since Webflow doesn't support it.

### Fix 3: Fix AS-069 tests in lib/webflow-converter/longhand.test.ts
The tests need TWO directions:

**Direction A (must-drop):** All shorthands (from css-shorthand-properties minus PASS_THROUGH, plus EXTRA_SHORTHANDS, plus SHORTHANDS) must NOT appear in parseCss output.

**Direction B (must-survive):** All PASS_THROUGH properties must survive parseCss with their values intact.

```typescript
it('AS-069: PASS_THROUGH longhands are never warn-and-dropped', () => {
  for (const prop of ['background-position', 'background-size', 'grid-row', 'grid-column', 'grid-area']) {
    const result = expandDeclaration(prop, 'center')
    expect(result.decls).toEqual({ [prop]: 'center' })
    expect(result.warning).toBeUndefined()
  }
})

it('AS-069: EXTRA_SHORTHANDS properties are warn-and-dropped', () => {
  for (const prop of ['overscroll-behavior', 'border-inline-start', 'border-inline-end', 
                       'border-block-start', 'border-block-end', 'contain-intrinsic-size',
                       'font-synthesis', 'animation-range']) {
    const result = expandDeclaration(prop, 'test')
    expect(result.decls).toEqual({})
    expect(result.warning).toMatch(/shorthand/)
  }
})

it('AS-069: vendor-prefixed shorthands are warn-and-dropped', () => {
  for (const prop of ['-webkit-transition', '-webkit-animation', '-webkit-border-radius', '-webkit-box-shadow']) {
    const result = expandDeclaration(prop, 'test')
    expect(result.decls).toEqual({})
  }
})
```

Delete the tautological test `test_AS_069_parseCss_never_surfaces_a_shorthand_key_in_base_or_variant_buckets` — it checks isShorthand over output the same predicate decided.

### Fix 4 (M-a): flex-flow unknown token must not overwrite flex-direction
In expandFlexFlow (or wherever flex-flow tokens are parsed):
If a token cannot be classified as flex-direction or flex-wrap, warn and skip it instead of letting it overwrite flex-direction.

### Fix 5 (M-a): list-style unknown token must not overwrite list-style-type
In expandListStyle: if token is not recognized as type/position/image, warn and skip instead of overwriting.

### Fix 6 (M-c): fix gap/overflow/place-* undefined values
For `expandGap`, `expandOverflow`, `expandPlace*`, `expandFlex` — add the same guard as border-radius:
If value is empty/whitespace, return `{decls:{}, warning: "property: empty value skipped"}`.

Also fix `expandTransition`: if value is empty, return `{decls:{}, warning: "transition: empty value skipped"}` instead of four empty strings.

### Fix 7 (M-j / AS-135): Fix mislabeled tests in longhand.test.ts
The scrutiny found tests with wrong AS- labels. Read longhand.test.ts and find tests labeled with wrong assertion IDs. Common mislabels: tests that say AS_057 but test something else. Fix labels to match what each test actually tests.

## Definition of done
- `parseCss('.x{background-position:50% 50%}')` → base has `background-position:'50% 50%'`, no warning
- `parseCss('.x{overscroll-behavior:contain}')` → base is empty, warning mentions overscroll-behavior  
- `parseCss('.x{border-inline-start:1px solid red}')` → base is empty, warning
- `parseCss('.x{-webkit-box-shadow:0 2px 4px red}')` → base is empty, warning
- `parseCss('.x{flex-flow:wrap row extra}')` → flex-wrap:'wrap', flex-direction:'row', warning about 'extra'
- `parseCss('.x{gap:}')` → base is empty, warning (not undefined values)
- Suite is GREEN (no failing tests)
- npx tsc --noEmit clean
- npm run lint clean
