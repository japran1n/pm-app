# F060: comprehensive longhand.ts fixes (blocker + 4 majors)

**Milestone:** M2 follow-ups
**Estimated worker time:** 45 minutes
**Depends on:** F057

## Assertion IDs covered
- AS-069, AS-055, AS-067, AS-063, AS-065

## Clarified implementation
(Inherited from F005–F010)

## Follow-up scope (FU-M2-14, FU-M2-15, FU-M2-16, FU-M2-17, FU-M2-19)

### FU-M2-14 (BLOCKER): Independent shorthand vocabulary for AS-069

Install the `css-shorthand-properties` npm package:
```
npm install css-shorthand-properties
```

Then in `lib/webflow-converter/longhand.ts`:

1. Import it: `import shorthandProperties from 'css-shorthand-properties'`
   - This package exports an object whose keys are shorthand property names and
     values are arrays of the longhands they expand to.
   - Example: `shorthandProperties['border']` → `['border-width', 'border-style', ...]`

2. Create a helper that normalizes vendor prefixes before lookup:
   ```typescript
   function stripVendorPrefix(prop: string): string {
     return prop.replace(/^-(?:webkit|moz|ms|o)-/, '')
   }
   ```

3. In `expandDeclaration`'s `default:` branch, check BOTH the existing SHORTHANDS set
   AND the independent vocabulary:
   ```typescript
   default: {
     const bare = stripVendorPrefix(prop)
     if (isShorthand(prop) || bare in shorthandProperties || bare !== prop) {
       // prop is a shorthand or vendor-prefixed shorthand
       return { decls: {}, warning: `shorthand '${prop}' is not supported — write longhands instead` }
     }
     return { decls: { [prop]: value } }
   }
   ```

4. Rewrite the AS-069 tests in `lib/webflow-converter/longhand.test.ts`:
   - Delete `test_AS_069_parseCss_never_surfaces_a_shorthand_key_in_base_or_variant_buckets`
     (it's a tautology — checks isShorthand over output that isShorthand decided)
   - Rewrite `test_AS_069_shorthand_vocabulary_whitelist_recognizes_all_missing_properties`
     to use `Object.keys(shorthandProperties)` as its corpus:
     ```typescript
     import shorthandProperties from 'css-shorthand-properties'
     it('AS-069: every property in css-shorthand-properties is caught', () => {
       for (const prop of Object.keys(shorthandProperties)) {
         const result = expandDeclaration(prop, 'test')
         expect(result.decls).toEqual({})
         expect(result.warning).toMatch(/shorthand/)
       }
     })
     ```
   - Add a vendor-prefix test:
     ```typescript
     it('AS-069: vendor-prefixed shorthands are caught', () => {
       for (const prefix of ['-webkit-', '-moz-', '-ms-', '-o-']) {
         for (const prop of ['transition', 'animation', 'border-radius']) {
           const result = expandDeclaration(`${prefix}${prop}`, 'test')
           expect(result.decls).toEqual({})
         }
       }
     })
     ```

### FU-M2-15: parseBorderParts unitless-zero and outline-auto

In `lib/webflow-converter/longhand.ts`, fix `isWidth` and `parseBorderParts`:

1. In `isWidth(token)`: treat bare `0` as a width (special case before unit check):
   ```typescript
   function isWidth(token: string): boolean {
     if (token === '0') return true
     // ... rest of existing logic
   }
   ```

2. In the outline style vocabulary (the array/set used by `parseBorderParts` or
   expandBorder/expandOutline), add `'auto'` so `outline: 2px auto -webkit-focus-ring-color`
   correctly outputs width+style+color.

3. Add tests:
   - `border: 0` → `{border-top-width:'0', border-right-width:'0', border-bottom-width:'0', border-left-width:'0', border-top-style:..., ...}` (no color:'0')
   - `outline: 0` → `{outline-width:'0'}` (no color:'0')
   - `outline: 2px auto -webkit-focus-ring-color` → has outline-style:'auto'

### FU-M2-16: No expander may emit undefined values

In `lib/webflow-converter/longhand.ts`, fix `box()`:

1. In the `box()` helper function, when the parts array is shorter than expected,
   return empty string `''` or skip the key entirely — never `undefined`:
   ```typescript
   // Instead of: { [topKey]: parts[0], [rightKey]: parts[1], ... }
   // Do:
   const result: Record<string,string> = {}
   if (parts[0] !== undefined) result[topKey] = parts[0]
   // etc.
   ```

2. Add empty-value tests that explicitly check `Object.entries(decls).every(([,v]) => v !== undefined)`.

### FU-M2-17: expandTransition unknown tokens must not overwrite transition-property

In `lib/webflow-converter/longhand.ts`, in `expandTransition`:

The catch-all `else` in the per-item token loop currently assigns any unmatched
token to `transition-property`. Fix: if `transition-property` is already set,
don't overwrite it — emit a warning instead:
```typescript
} else {
  if (item['transition-property']) {
    warnings.push(`transition: unrecognised token '${token}' discarded`)
  } else {
    item['transition-property'] = token
  }
}
```

Recognize `var(...)` as an unclassifiable token — check `token.startsWith('var(')`.

Apply the same rule to `flex-flow` and `list-style`: stray tokens should warn,
not overwrite the already-set longhand.

Add tests:
- `transition: opacity .2s var(--ease)` → `transition-property: 'opacity'`, warning about var(--ease)
- `flex-flow: row wrap extra` → warning about 'extra', flex-direction/wrap not overwritten

### FU-M2-19: font shorthand vocabulary gaps

In `lib/webflow-converter/longhand.ts`, fix `expandFont`:

1. Normalize whitespace around the size/line-height slash before `includes('/')`:
   Before splitting on `/`, replace ` / ` with `/` (trim whitespace around slash)

2. Extend the weight regex to accept `1000` (CSS4 upper bound):
   Change `/^([1-9]\d{0,2})$/` to `/^(1000|[1-9]\d{0,2})$/` or `/^(?:1000|[1-9]\d{0,2})$/`

3. When `small-caps` is found in the font tokens, emit `font-variant: 'small-caps'`
   instead of consuming and discarding it

4. When a system-font keyword (`caption`, `menu`, `status-bar`, `icon`, `message-box`,
   `small-caption`) is found as the entire font value, warn and return `{}`:
   Return `{decls: {}, warning: "font: system-font keyword '<keyword>' not supported"}`

Add tests:
- `font: 16px / 1.5 Arial` → `{font-size:'16px', line-height:'1.5', font-family:'Arial'}`
- `font: 1000 14px Inter` → `{font-weight:'1000', font-size:'14px', ...}`
- `font: small-caps 16px Inter` → includes `font-variant: 'small-caps'`
- `font: caption` → `{}` + warning

## Definition of done
- `parseCss('.x{-webkit-transition:all .2s ease}')` → `{}` + warning (not in base)
- `parseCss('.x{column-rule:1px solid red}')` → `{}` + warning
- `parseCss('.x{border:0}')` → has border-*-width:'0', NOT border-*-color:'0'
- `parseCss('.x{transition:opacity .2s var(--ease)}')` → transition-property:'opacity'
- `parseCss('.x{font:16px / 1.5 Arial}')` → line-height:'1.5'
- All AS-069 tests use `Object.keys(shorthandProperties)` as corpus
- All 187+ tests pass; tsc and lint clean
