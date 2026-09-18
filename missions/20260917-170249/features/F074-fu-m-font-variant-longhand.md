# F074: fix font expander to emit font-variant-caps instead of font-variant (blocker AS-069)

**Milestone:** M2 follow-ups round 8
**Depends on:** F073

## Clarified implementation (inherited)

## Follow-up scope (from M2-scrutiny-8.md B1)

`expandFont` in `lib/webflow-converter/longhand.ts` emits `font-variant: 'small-caps'` but `font-variant` is itself a CSS shorthand. The correct longhand is `font-variant-caps`.

### Fix 1: change `font-variant` emission to `font-variant-caps`

In expandFont, find the line that sets `out['font-variant'] = token` and change it to:
`out['font-variant-caps'] = token`

Supported values: `small-caps`, `all-small-caps`, `petite-caps`, `all-petite-caps`, `unicase`, `titling-caps`, `normal`

### Fix 2: update the test that asserts the wrong behavior

In `longhand.test.ts`, find `test_AS_065_small_caps_sets_font_variant` (or similar name) that asserts `font-variant` in the output. Change it to assert `font-variant-caps` instead.

### Fix 3: add output-side sweep to AS-069 tests

In the AS-069 test block in `longhand.test.ts`, add an output-side assertion. After the existing sweep that verifies the shorthand's own key is not in decls, add:

```typescript
// Every key emitted by expandDeclaration must itself NOT be a shorthand
// This catches the case where an expander emits a shorthand key
it('expandFont with small-caps emits only longhand keys', () => {
  const result = expandDeclaration('font', 'small-caps 16px Arial')
  for (const key of Object.keys(result.decls)) {
    // font-variant is a shorthand — it must not be emitted
    expect(isShorthand(key)).toBe(false)
    // Specifically verify font-variant-caps (the correct longhand) is there
  }
  expect(result.decls['font-variant-caps']).toBe('small-caps')
  expect(result.decls['font-variant']).toBeUndefined()
})
```

Note: `isShorthand` may need to be exported from longhand.ts for this test. If not already exported, export it.

### Fix 4: fix the dead assertion in css.test.ts (B3)

Find the test added by F073 in css.test.ts that filters warnings for `"is not a recognized"`. The real warning text is `"shorthand '...' is not supported"`. Either:
- Change the filter string to `"is not supported"`, OR
- Remove the filter and just check `result.warnings.length === 0` directly for the hero stylesheet (which has no shorthands, so should have 0 warnings)

Run: npx vitest run lib/webflow-converter/
Run: npx tsc --noEmit
Run: npm run lint

Write handoff to: missions/20260917-170249/handoffs/F074-handoff.md
Commit: "fix(AS-069,AS-135): font emits font-variant-caps not font-variant; fix dead test assertion"
