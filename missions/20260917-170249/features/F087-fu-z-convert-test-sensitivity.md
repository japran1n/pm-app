# F087: convert.ts test sensitivity gaps (AS-119, AS-051, AS-114, AS-069)

**Milestone:** M3 follow-ups round 3
**Depends on:** F082, F083

## Follow-up scope (from M3-scrutiny-3.md FU-E, non-blocking R-4, R-6)

### Fix 1: replace AS-119 tautology in convert.test.ts

`convert.test.ts:141-158` is `if (errors.length > 0) expect(null) else expect(not null)` — it can never fail. Replace with tests that construct genuinely invalid inputs and assert `payload === null` unconditionally:

```typescript
it('AS-119: illegal class name produces payload null', async () => {
  // A class name starting with a digit is invalid
  const result = await convert('<div class="1bad"></div>', '.\\31 bad{color:red}')
  // Either the CSS parse rejects it or the validator does
  expect(result.payload).toBeNull()
  expect(result.errors.length).toBeGreaterThan(0)
})

it('AS-119: unresolved class reference produces payload null', async () => {
  const result = await convert('<div class="missing"></div>', '')
  expect(result.payload).toBeNull()
  expect(result.errors.some(e => e.includes('missing'))).toBe(true)
})

it('AS-119: empty HTML produces payload null (AS-112)', async () => {
  const result = await convert('', '')
  expect(result.payload).toBeNull()
})
```

### Fix 2: AS-051 combo-chain branch coverage

Add a test that the combo-chain branch in the unused-class detection is exercised:

```typescript
it('AS-051: two elements with classes A and B, CSS has A+B combo — combo not flagged unused', async () => {
  const result = await convert('<div class="btn"></div><div class="mod"></div>', '.btn{} .mod{} .btn.mod{}')
  // .btn.mod combo is defined in CSS but not used by a single element — should warn
  expect(result.warnings.some(w => w.includes('btn') && w.includes('unused') || w.includes('mod'))).toBeTruthy()
})

it('AS-051: one element with both classes A and B — combo not flagged unused', async () => {
  const result = await convert('<div class="btn mod"></div>', '.btn{} .mod{} .btn.mod{}')
  // combo IS used by this element
  expect(result.warnings.filter(w => w.includes('not used'))).toHaveLength(0)
})
```

### Fix 3: AS-114 at depth 3

```typescript
it('AS-114: class on 3rd-level descendant with no CSS → payload null', async () => {
  const result = await convert('<div><p><span class="deep-ghost">x</span></p></div>', '')
  expect(result.payload).toBeNull()
  expect(result.errors.some(e => e.includes('deep-ghost'))).toBe(true)
})
```

### Fix 4: extend AS-011 scan to include page components

In convert.test.ts's AS-011 test, extend the glob to also scan `app/**/webflow*` and `components/**/webflow*` (the future converter page files), not just `lib/webflow-converter`.

Run: npx vitest run lib/webflow-converter/
Run: npx tsc --noEmit
Run: npm run lint

Write handoff to: missions/20260917-170249/handoffs/F087-handoff.md
Commit: "test(AS-119,AS-051,AS-114,AS-011): replace tautology; add depth-3, combo-chain, page-scan tests"
