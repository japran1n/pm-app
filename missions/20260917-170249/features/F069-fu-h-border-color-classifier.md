# F069: complete border/outline kind classifier, close color catch-all (blocker AS-055 AS-056 AS-067)

**Milestone:** M2 follow-ups round 6
**Depends on:** F067

## Clarified implementation (inherited)

## Follow-up scope (from M2-scrutiny-6.md B-2)

Fix `parseBorderParts` in `lib/webflow-converter/longhand.ts`:

### 1. Replace the unguarded `else` color slot with an explicit color test

The current code classifies "everything else" as color. Replace with an explicit `isColor(token)` test:

```typescript
function isColor(token: string): boolean {
  // Named colors, hex, functional notation, keywords
  const COLOR_KEYWORDS = new Set(['currentcolor', 'transparent', 'invert'])
  const t = token.toLowerCase()
  if (COLOR_KEYWORDS.has(t)) return true
  if (t.startsWith('#')) return true
  if (/^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklch|oklab|color|light-dark)\s*\(/.test(t)) return true
  // Named CSS colors (basic set — at minimum the 140 named colors)
  // Simple heuristic: alphabetic-only token that isn't a width/style keyword → likely a color name
  // But to be safe, maintain a small set of common color names OR use /^[a-z]+$/ with exclusions
  if (/^[a-z]+$/.test(t) && !BORDER_STYLES.has(t)) return true
  return false
}
```

When a token matches no kind (not width, not style, not color), warn and drop the whole declaration: `"border: unrecognized token '<token>' — use individual border-* properties instead"`.

### 2. Widen `isWidth` to include modern CSS length units

Add to the unit list: `svh|lvh|dvh|svw|lvw|dvw|svmin|svmax|dvmin|dvmax|lh|rlh|cap|ic|rcap|rex|rch|Q|cqw|cqh|cqi|cqb|cqmin|cqmax`

Also support scientific notation: `1e2px`, `1.5e-3em` → these match `/^-?(?:\d+\.?\d*|\d*\.\d+)(?:[eE][+-]?\d+)?(?:px|em|...)$/`

Remove `fr` from the width unit list — it's a grid unit, not valid for border-width.

### 3. Fix warning when color evicts a genuine color

When an extra color token arrives (color slot already filled), warn about the correct token.

Add tests:
- `border:1svh solid red` → `{}` + warning about unrecognized `1svh` (or width with warning, NOT putting svh in color slot)
  Actually: svh IS a valid length unit after fix → width:'1svh', style:'solid', color:'red' ✓
- `border:1px solid slid` → `{}` + warning "unrecognized token 'slid'"
- `border:solid !important` → `{}` + warning "unrecognized token '!important'"
- `border:1cqw solid blue` → width:'1cqw', style:'solid', color:'blue' ✓
- `border:1e2px solid red` → width:'100px' or width:'1e2px' (preserve as-is), style:'solid', color:'red'
- Verify `border-*-color` never receives a length token

## Definition of done
- `npx vitest run lib/webflow-converter/` 0 failed
- `npx tsc --noEmit` clean
- `npm run lint` clean
- Handoff to missions/20260917-170249/handoffs/F069-handoff.md
- Commit: "fix(AS-055,AS-056,AS-067): explicit color classifier in parseBorderParts, widen isWidth units"
