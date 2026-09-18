# F049: icon token theming assertion (AS-127)

**Milestone:** M1 follow-ups
**Estimated worker time:** 20 minutes
**Depends on:** F044

## Assertion IDs covered
- AS-127

## Clarified implementation
(Inherited from F044)

## Follow-up scope (from M1-scrutiny-2.md — FU-9)
Assert the icon element's own `className` carries a semantic token that is not
`text-tertiary-foreground` (CLAUDE.md bans that token for operative content).
Minimum acceptable: assert the icon carries `text-muted-foreground` and confirm
that swapping the icon token to `text-tertiary-foreground` in
`components/nav/app-sidebar.tsx` turns the test red. Additionally, explicitly
decide whether the active item's icon should lift to `text-foreground` alongside
its label — today it does not, and that is an unrecorded legibility decision.
Document the decision in a comment. If contrast cannot be asserted in jsdom,
route AS-127 to the UX validator explicitly rather than leaving a jsdom test
claiming to cover it.

## Definition of done
- **Primary success test:** icon token assertion mutation-verified (swap to banned token → red)
- **Failure test:** banned token mutation turns test red
- **Manual verification:** none — automated suffices
- **Side-effect verification:** only test file changes (and possibly one-line comment in source)
- **Evidence artifact:** test output + mutation transcript in handoff
