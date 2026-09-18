# F079: AS-141 realistic-section integration test

**Milestone:** M3 follow-ups round 1
**Depends on:** F076, F075

## Clarified implementation (inherited from F021)

## Follow-up scope (from M3-scrutiny-1.md B-6)

No test exists for a realistic section with nested containers, heading, link, combo class, hover state, and two breakpoints. Add it in `convert.test.ts`.

### Test to add

```typescript
it('AS-141: realistic section — nested containers, combo class, hover, two breakpoints', async () => {
  const html = `
    <section class="hero">
      <div class="container">
        <h1 class="hero-title">Hello</h1>
        <a class="btn btn--primary" href="#">Get Started</a>
        <ul class="list">
          <li class="list__item">Item 1</li>
        </ul>
      </div>
    </section>
  `
  const css = `
    .hero { display: flex; padding: 48px 24px; }
    .container { max-width: 1200px; margin: 0 auto; }
    .hero-title { font-size: 48px; color: #111; }
    .btn { display: inline-block; padding: 12px 24px; }
    .btn--primary { background-color: #0070f3; color: #fff; }
    .btn:hover { background-color: #005ac2; }
    .list { list-style: none; }
    .list__item { margin-bottom: 8px; }
    @media (max-width: 991px) {
      .hero { padding: 32px 16px; }
    }
    @media (max-width: 479px) {
      .hero-title { font-size: 32px; }
    }
  `
  const result = await convert(html, css)

  // No errors
  expect(result.errors).toHaveLength(0)

  // Payload has correct type envelope
  expect((result.payload as any)?.type).toBe('@webflow/XscpData')

  // Node count: section > div > h1 + a + ul > li = 6 nodes
  const nodes = result.payload?.payload.nodes ?? []
  expect(nodes.length).toBeGreaterThanOrEqual(6)

  // Style count: 8 classes defined
  const styles = result.payload?.payload.styles ?? []
  expect(styles.length).toBeGreaterThanOrEqual(8)

  // Combo: btn--primary has comb: "btn"; btn.children includes btn--primary._id
  const btnStyle = styles.find((s: any) => s._id === 'btn')
  const btnPrimaryStyle = styles.find((s: any) => s._id === 'btn--primary' || s.comb === 'btn')
  expect(btnPrimaryStyle).toBeDefined()
  expect(btnStyle?.children).toContain(btnPrimaryStyle?._id)

  // Hover variant present on btn
  expect(btnStyle?.variants).toBeDefined()
  const hoverVariant = Object.values(btnStyle?.variants ?? {}).find((v: any) => typeof v === 'object')
  // At minimum, a hover variant slot should be present (even if mapped to 'hover' key)
  // Assert background-color is present in some variant
  const hasHoverBg = JSON.stringify(btnStyle?.variants).includes('background-color')
  expect(hasHoverBg).toBe(true)

  // Breakpoint variants: hero has medium and small variants
  const heroStyle = styles.find((s: any) => s._id === 'hero')
  expect(heroStyle?.variants).toBeDefined()
  const variantKeys = Object.keys(heroStyle?.variants ?? {})
  expect(variantKeys.some(k => k === 'medium' || k === 'mediumScreen')).toBe(true)

  // No shorthand in any emitted styleLess
  for (const style of styles) {
    if (style.styleLess) {
      const props = style.styleLess.split(';').map((d: string) => d.split(':')[0].trim()).filter(Boolean)
      for (const prop of props) {
        // Known shorthands that must not appear
        const SHORTHANDS = ['font', 'background', 'border', 'margin', 'padding', 'flex', 'grid', 'transition', 'animation', 'outline', 'list-style']
        for (const sh of SHORTHANDS) {
          expect(prop).not.toBe(sh)
        }
      }
    }
  }
})
```

Note: this test depends on F075 (validator complete) and F076 (envelope + combo + hover). Run it after those workers complete.

Run: npx vitest run lib/webflow-converter/
Run: npx tsc --noEmit
Run: npm run lint

Write handoff to: missions/20260917-170249/handoffs/F079-handoff.md
Commit: "test(AS-141): realistic section integration test — combo, hover, breakpoints, envelope"
