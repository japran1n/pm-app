# Clarification — F031 [CLARIFIED-AUTO]

_Auto-clarified: discovery round-1.md + round-2.md answers are comprehensive.
No additional constraints beyond the feature spec._

## Defaults applied

- Follow feature spec literally.
- Use discovery answers for any ambiguity (see missions/20260920-124226/discovery/).
- All ★ defaults are the spec defaults.

## AS-015 note (from M1-scrutiny-2, deferred)
AS-015: "The Planner honours no ?view= parameter; supplying one changes nothing."
This assertion must be verified in F031 when the Planner route exists.
Test: pass `?view=stacked` in searchParams; assert the output is identical to the same request without it.
The pure-logic layer never reads ?view= — verification requires the route.
