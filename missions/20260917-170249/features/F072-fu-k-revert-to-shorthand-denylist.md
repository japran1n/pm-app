# F072: revert allow-list, use shorthand deny-list for AS-069 (blocker AS-069)

**Milestone:** M2 follow-ups round 7
**Depends on:** F071

## Clarified implementation (inherited)

## Follow-up scope (from M2-scrutiny-7.md B1)

F071's longhand allow-list is the wrong mechanism. It breaks `width`, `height`, `min/max-width`, `min/max-height`, `box-shadow`, `text-shadow`, and many other valid longhands.

The correct mechanism for AS-069 ("no shorthand in the output") is a **shorthand deny-list** — warn-and-drop only properties that ARE known shorthands. Everything else passes through verbatim.

## The fix

In `lib/webflow-converter/longhand.ts`:

1. Remove the `LONGHAND_ALLOW_LIST` Set entirely.

2. Revert the default branch of `expandDeclaration` back to pass-through:
```typescript
// default branch (after all expander cases and PASS_THROUGH check)
return { decls: { [prop]: value } }
```

3. KEEP the existing SHORTHANDS, EXTRA_SHORTHANDS sets, and the `isShorthand(prop)` check that warns-and-drops known shorthands. Add `marker` and `position-try` to EXTRA_SHORTHANDS:
```typescript
const EXTRA_SHORTHANDS = new Set([
  // ... existing entries ...
  'marker',         // shorthand for marker-start/-mid/-end
  'position-try',   // shorthand for position-try-order/-fallbacks
])
```

This means:
- Properties in SHORTHANDS or EXTRA_SHORTHANDS → warn-and-drop (AS-069 satisfied)
- Properties in PASS_THROUGH → pass through (AS-076 etc. satisfied)
- Everything else → pass through (unknown-but-valid longhands like `width`, `height`, etc.)

The key insight: AS-069 says "no shorthand shall reach the payload". It does NOT say "only allow-listed properties shall pass". The deny-list is the correct, maintainable approach.

## Verify these work after fix (end-to-end through parseCss)
- `.hero{width:100%;height:400px;max-width:1200px}` → all three properties in output, no warnings
- `.a{box-shadow:0 2px 4px rgba(0,0,0,.2)}` → box-shadow in output, no warning
- `.a{marker:url(#m)}` → {} + warning (deny-list entry)
- `.a{position-try:flip-block}` → {} + warning (deny-list entry)
- `.a{color:red}` → {color:'red'}, no warning

Run: npx vitest run lib/webflow-converter/
Run: npx tsc --noEmit
Run: npm run lint

Write handoff to: missions/20260917-170249/handoffs/F072-handoff.md
Commit: "fix(AS-069): revert allow-list, use shorthand deny-list — width/height/box-shadow now pass through"
