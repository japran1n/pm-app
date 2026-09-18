# F068: validate font-size slot and make prefix loop stateful (blocker AS-065)

**Milestone:** M2 follow-ups round 6
**Depends on:** F067

## Clarified implementation (inherited)

## Follow-up scope (from M2-scrutiny-6.md B-1)

Fix `expandFont` in `lib/webflow-converter/longhand.ts`:

1. After the optional style/weight/variant/stretch prefix loop, before assigning `parts[i]` to `font-size`, validate that the token IS a CSS length/percentage/absolute-size keyword. Valid:
   - Length: any number followed by a length unit (px, em, rem, %, pt, cm, vw, vh, svh, dvh, lvh, cqw, etc.) or `0`
   - Absolute size keywords: xx-small, x-small, small, medium, large, x-large, xx-large, xxx-large
   - Relative size keywords: smaller, larger
   - Mathematical: calc(), clamp(), min(), max()
   
2. If the token is NOT a valid font-size (e.g. 'Arial', 'Georgia', a var() that looks like a family), return `{}` with a warning: `"font: expected a length for font-size but got '<token>' — use individual font-* properties instead"`.

3. Make the prefix loop STATEFUL — track which of style/weight/variant/stretch has been assigned. If a token matches an already-filled slot, fall through to the next unfilled slot. A genuinely duplicate kind (both tokens clearly that kind) should warn. This fixes `font: normal normal 14px Arial` losing font-weight.

4. var() for font-size: also emit warning and return `{}`.

Add tests:
- `font:bold Arial` → `{}` + warning (family in size slot)
- `font:italic Georgia` → `{}` + warning
- `font:var(--font)` → `{}` + warning
- `font:normal normal 14px Arial` → font-style:normal, font-weight:normal, font-size:14px, font-family:Arial (NOT losing weight)
- `font:bold 14px Arial` → font-weight:bold, font-size:14px, font-family:Arial
- `font:condensed 14px Arial` → still works (font-stretch:condensed, font-size:14px)

## Definition of done
- `npx vitest run lib/webflow-converter/` 0 failed
- `npx tsc --noEmit` clean
- `npm run lint` clean
- Handoff to missions/20260917-170249/handoffs/F068-handoff.md
- Commit: "fix(AS-065): validate font-size slot and make prefix loop stateful"
