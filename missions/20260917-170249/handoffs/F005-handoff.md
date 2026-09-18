# Handoff: F005 — longhand box shorthands

## Status
COMPLETE

## Assertions covered
AS-053: PASS — margin with 1/2/3/4 values expands to margin-top/right/bottom/left per the CSS box rule (test_AS_053_*).
AS-054: PASS — padding expands the same way as margin (test_AS_054_*).
AS-068: PASS — a global keyword (inherit/initial/unset/revert) on a shorthand (margin/padding/inset) is dropped with a warning instead of being mis-split; case-insensitive; does not apply to non-shorthand properties (test_AS_068_*).

## Assertion ID note
The task dispatch at the top of this run listed AS-055, AS-056, AS-057, AS-058
as assigned to F005, but those IDs (border shorthand, single-side border,
border-radius, gap) belong to sibling features F006/F007 per
`missions/20260917-170249/plan.md` lines 38-40 and the feature spec file
`features/F005-longhand-box-shorthands.md` itself, which states scope as
margin/padding/inset/border-width/border-style/border-color plus the
global-keyword guard, covering AS-053, AS-054, AS-068 (see
validation-contract.md lines 76-91). I followed the feature spec (the
declared source of truth) and the plan.md feature-to-assertion mapping over
the possibly-stale IDs in the dispatch message. border-width/border-style/
border-color were left out of this feature's actual implementation because
the clarified spec's own "Draft scope" line lists them, but plan.md assigns
this feature only AS-053/AS-054/AS-068 and F006 (longhand-border-and-radius)
owns the border-* work — I implemented exactly the assertions this feature
is on the hook for (margin, padding, inset, global-keyword guard) to avoid
overlapping F006's scope.
AUTONOMOUS_DECISION: Resolved the AS-ID mismatch between the dispatch
message and plan.md/validation-contract.md by trusting plan.md +
validation-contract.md (the immutable source of truth) and the feature
spec's own assertion list, not the possibly-stale dispatch header.
SUGGESTED FOLLOWUP: Orchestrator should verify the F005 dispatch template
pulls assertion IDs from plan.md/validation-contract.md rather than a cached
value, so future worker dispatches for this mission carry the correct IDs.

## Files changed
lib/webflow-converter/longhand.ts
lib/webflow-converter/longhand.test.ts

## Commands run
`npx vitest run lib/webflow-converter/longhand.test.ts` (0) — 21 passed
`npx tsc --noEmit -p .` (checked for longhand.ts-related errors; none found)
`git status --short` (0)
`git add lib/webflow-converter/longhand.ts lib/webflow-converter/longhand.test.ts && git commit` (0)

## Decisions made
- Byte-for-byte logic port of `box()`, `splitTop()`, `isShorthand()`, and the
  margin/padding/inset branches of `expandDeclaration()` from
  ~/Desktop/html-to-webflow/src/longhand.mjs, with TypeScript types added
  (ExpandResult interface) per the clarified "port fidelity" answer.
- Kept the `SHORTHANDS` set identical to the prototype (including border/gap/
  flex/etc. names) because `isShorthand()` must correctly gate the
  global-keyword guard for every shorthand property name, even though this
  feature only implements the box-rule branches. Unimplemented shorthand
  properties fall through to the `default` case (pass-through), which is
  correct behavior until sibling features (F006-F010) add their branches to
  this same switch.
- Did not port border-width/border-style/border-color/border/border-*,
  transition, flex, gap, etc. — those are F006-F010's scope per plan.md.
- Exported only `expandDeclaration`, `isShorthand`, and `splitTop`, mirroring
  the prototype's public surface (all three are exported there too); kept
  `box()` unexported as an internal helper, per the clarified "public API
  surface" answer (export only what's needed, helpers unexported) — `box`
  isn't needed by callers so it stays private, matching prototype fidelity
  on the exported names that matter (splitTop, isShorthand, expandDeclaration
  are all used downstream by F011's shorthand detector and F014's parse
  orchestration).

## Out-of-scope work needed
- border, border-top/right/bottom/left, border-width/style/color,
  border-radius → F006 (longhand-border-and-radius)
- gap, grid-gap, overflow, place-items/content/self → F007
- flex, flex-flow → F008
- transition → F009
- font, list-style, outline, background → F010
These all extend the same `expandDeclaration` switch statement in
lib/webflow-converter/longhand.ts; sibling features should add cases to the
existing switch rather than duplicating the global-keyword guard or the
`box()`/`splitTop()` helpers already here.

## Blockers
(none — Status is COMPLETE)

## Notes for the next worker
- The switch statement in `expandDeclaration` in longhand.ts is the
  extension point for F006-F010: add a `case` per shorthand property, reusing
  `splitTop`/`box` as needed. Do not duplicate the global-keyword guard at
  the top of the function — it already applies to any property for which
  `isShorthand()` returns true, so any new shorthand branch just needs its
  name added to `SHORTHANDS` (already present in this file for all
  prototype shorthands) and a `case` in the switch.
- No MCP tools used — this is a pure, in-repo TypeScript port with no
  external service dependency, consistent with the feature spec's "MCP at
  run: none".
- Test evidence: `npx vitest run lib/webflow-converter/longhand.test.ts`
  → 21 passed, 0 failed (see Commands run).
