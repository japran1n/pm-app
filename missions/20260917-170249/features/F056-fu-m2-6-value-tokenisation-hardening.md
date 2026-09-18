# F056: value tokenisation hardening (major)

**Milestone:** M2 follow-ups
**Estimated worker time:** 30 minutes
**Depends on:** F006, F008, F010

## Assertion IDs covered
- AS-055, AS-061, AS-065, AS-067

## Clarified implementation
(Inherited from F006/F008/F010)

## Follow-up scope (from M2-scrutiny.md — FU-M2-6)
Three targeted fixes:

1. **var()/calc() in border/outline width classification:** Only treat a token as a width when it carries a length unit (px/em/rem/%) or is a named width keyword (thin/medium/thick). A `var()` or `calc()` token without a unit should go to the colour slot (or be left unclassified with a warning).

2. **font weight regex:** Widen the weight regex in `expandFont` to accept any 1–3 digit numeric weight: `/^([1-9]\d{0,2})$/` (covers 1–999). Weight 450, 350, 550 are mandated by this repo's design system and currently get misclassified as font-size.

3. **flex: initial reconcile AS-061 vs AS-068:** Per AS-061 the global keywords (initial/inherit/unset/revert/revert-layer) should expand `flex-grow:0; flex-shrink:1; flex-basis:auto` for `initial`, etc. Per AS-068 global keywords are warned-and-dropped. Remove the dead branch in expandFlex and pick one behaviour (warn-and-drop is simpler and the global-keyword guard in F005 already handles this at the expandDeclaration level — so `flex: initial` is caught there before reaching expandFlex).

## Definition of done
- `border: solid var(--accent)` does not put var() in border-*-width
- `font: 450 15px Inter` produces font-weight: 450, font-size: 15px
- `flex: initial` handled consistently (either warned-and-dropped or correctly expanded)
