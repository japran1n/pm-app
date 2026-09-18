# F054: paren-aware and nesting-aware CSS parsing (AS-057)

**Milestone:** M2 follow-ups
**Estimated worker time:** 25 minutes
**Depends on:** F014

## Assertion IDs covered
- AS-057

## Clarified implementation
(Inherited from F014)

## Follow-up scope (from M2-scrutiny.md — FU-M2-4)
Two fixes:

1. Replace the raw `value.split('/')` in `expandBorderRadius` (lib/webflow-converter/longhand.ts) with a paren-aware split so `calc(100%/2)` survives. The `splitTop` helper already exists for this — use it. Only emit the elliptical-radii warning when a genuine top-level `/` was found.

2. Replace `node.walkDecls` in `css.ts` (around line 150) with iteration over the rule's DIRECT declaration children (`rule.nodes.filter(n => n.type === 'decl')`). For nested rules (postcss nested-CSS / `&:hover` blocks), either handle them properly (emit as a hover variant) or emit a warning that nested CSS is unsupported and skip them — today they silently overwrite parent declarations.

Add tests: `border-radius: calc(100%/2)` → four equal corners of `calc(100%/2)`, nested `.a{color:red; &:hover{color:blue}}` → warning emitted (not silent loss).

## Definition of done
- calc() in border-radius parses correctly
- Nested CSS emits a warning instead of silently corrupting parent styles
