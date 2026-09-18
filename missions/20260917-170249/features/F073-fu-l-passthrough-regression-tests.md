# F073: add behavioural regression tests for longhand pass-through (blocker AS-135)

**Milestone:** M2 follow-ups round 7
**Depends on:** F072

## Clarified implementation (inherited)

## Follow-up scope (from M2-scrutiny-7.md B2)

The test suite currently has ZERO assertions that `width`, `height`, `box-shadow`, etc. survive expansion. A change that silently drops these passes 251/251 tests. This is AS-135 (test coverage must be behavioural, not implementation-mirroring).

## The fix

In `lib/webflow-converter/longhand.test.ts`, add a "real-world pass-through regression" test block:

```typescript
describe('pass-through regression — common longhands must survive', () => {
  // These properties are NOT shorthands. They must pass through with their
  // original value intact and produce no warning. If any of these start
  // producing warnings or empty decls, something regressed.
  const REAL_LONGHANDS: Array<[string, string]> = [
    ['width', '100%'],
    ['height', '400px'],
    ['min-width', '320px'],
    ['max-width', '1200px'],
    ['min-height', '50vh'],
    ['max-height', '80vh'],
    ['box-shadow', '0 2px 4px rgba(0,0,0,0.2)'],
    ['text-shadow', '1px 1px 2px black'],
    ['transform-style', 'preserve-3d'],
    ['touch-action', 'pan-x'],
    ['isolation', 'isolate'],
    ['caret-color', 'auto'],
    ['accent-color', 'blue'],
    ['tab-size', '4'],
    ['scroll-behavior', 'smooth'],
    ['columns', 'auto'],  // Note: this IS a shorthand → should warn
  ]
  
  const SHOULD_WARN = new Set(['columns'])  // known shorthand
  
  for (const [prop, value] of REAL_LONGHANDS) {
    it(`${prop}: ${value} → passes through or correctly warns`, () => {
      const result = expandDeclaration(prop, value)
      if (SHOULD_WARN.has(prop)) {
        expect(result.warnings?.length ?? 0).toBeGreaterThan(0)
      } else {
        // Must reach the payload
        expect(result.decls[prop]).toBe(value)
        // Must not warn
        expect(result.warnings ?? []).toHaveLength(0)
      }
    })
  }
  
  // End-to-end: a realistic hero section through parseCss
  it('parseCss: width/height/box-shadow survive end-to-end', () => {
    const result = parseCss(
      '.hero{width:100%;height:400px;max-width:1200px;min-height:50vh;box-shadow:0 2px 4px rgba(0,0,0,.2);color:#333;}'
    )
    const hero = result.classes.get('hero')
    expect(hero).toBeDefined()
    expect(hero!.base['width']).toBe('100%')
    expect(hero!.base['height']).toBe('400px')
    expect(hero!.base['max-width']).toBe('1200px')
    expect(hero!.base['min-height']).toBe('50vh')
    expect(hero!.base['box-shadow']).toBe('0 2px 4px rgba(0,0,0,.2)')
    expect(hero!.base['color']).toBe('#333')
    // No warnings for any of these
    expect(result.warnings.filter(w => w.includes("is not a recognized"))).toHaveLength(0)
  })
})
```

Note: remove the `columns` entry from the REAL_LONGHANDS list since it IS a shorthand — or keep it and document it as a SHOULD_WARN case.

Also fix from the scrutiny report: remove `columns` from the pass-through list (it's a shorthand and should warn).

Run: npx vitest run lib/webflow-converter/
Run: npx tsc --noEmit
Run: npm run lint

Write handoff to: missions/20260917-170249/handoffs/F073-handoff.md
Commit: "test(AS-135): behavioural pass-through regression tests for width/height/box-shadow etc."
