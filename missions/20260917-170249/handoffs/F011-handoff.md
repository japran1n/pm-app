# Handoff: F011 — longhand shorthand detector

## Status
COMPLETE

## Assertions covered
AS-069: PASS — `expandDeclaration` dispatch table and `isShorthand` verified by 8 new dispatcher-focused tests (`test_AS_069_*`) plus 2 new `isShorthand` true/false sweep tests, all passing alongside the 95 pre-existing longhand tests (105/105 total).

## Files changed
lib/webflow-converter/longhand.test.ts

## Commands run
`npx vitest run lib/webflow-converter/longhand.test.ts` (0) — 105 passed (105)
`npx tsc --noEmit -p .` (checked, no errors attributable to longhand.ts/longhand.test.ts)
`git commit` (0)

## Decisions made
- `expandDeclaration(prop, value)` and `isShorthand(prop)` were already fully ported into `lib/webflow-converter/longhand.ts` by prior sibling features (F005–F010): the switch dispatches box rule (margin/padding/inset), border family (border, border-top/right/bottom/left, border-width/style/color, border-radius), gap/overflow/place-* pair handler, flex/flex-flow handler, transition handler, and font/list-style/outline handler, with a pass-through default for anything else and a global-keyword-on-shorthand guard up front. No production code changes were needed — this feature's remaining work was closing test coverage specifically naming the dispatcher behavior (AS-069), which the prior features' tests exercised only indirectly per-branch.
- Did not implement `toStyleLess(decls)` mentioned in the feature's "Draft scope" line. The clarified implementation explicitly restricts public API surface to "only the one function this feature is named for" (the shorthand detector: `expandDeclaration`/`isShorthand`), and `toStyleLess` is a decl-map-to-CSS-string serializer — a distinct rendering concern, not a detector concern, and not referenced by this feature's "Files" or assertion IDs. Verified via grep that no other file in the repo currently references `toStyleLess`, so nothing is broken by omitting it.

## Out-of-scope work needed
- `toStyleLess(decls)` — render a `Record<string,string>` decl map to a Webflow `styleLess` string (`key: value; key: value;` format, per the reference prototype at `~/Desktop/html-to-webflow/src/longhand.mjs`). This belongs to whichever feature owns Webflow payload serialization/rendering downstream of the longhand expansion (not yet present in the codebase as of this handoff). A future worker should add it as its own exported pure function, colocated tests, in the appropriate serializer module — likely a new file rather than `longhand.ts`, to keep this module's public surface to the shorthand-detection concern per the clarified "Module boundaries" answer.
- `background`, `animation`, `grid`, `grid-template`, `grid-area` are present in the `isShorthand` set but have no dedicated expander branch in `expandDeclaration` (they fall through to the default pass-through, i.e. left as unexpanded shorthand). This matches F011's clarified scope (box/border/gap-overflow-place/flex/transition/font-list-outline handlers only) and the reference prototype leaves them with a "left as shorthand" warning for `animation`/`grid*` and a dedicated `expandBackground` for `background` — neither of those refinements was in this feature's assigned scope, so not added here. If a future feature needs Webflow-safe expansion of `background`/`grid`/`animation`, it should be scoped explicitly with its own assertion IDs.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Treated F011's scope as "close out test coverage for the already-ported dispatcher/detector," since `expandDeclaration` and `isShorthand` were already present and working from F005–F010. Added targeted AS-069 dispatcher tests and a full isShorthand true/false sweep rather than re-deriving the dispatcher from the prototype, since the clarified spec says "Dependencies on existing code: only this feature's new files plus the specific sibling modules named in its own Depends on line" and F005–F010 are exactly those siblings.

## Notes for the next worker
- `lib/webflow-converter/longhand.ts` is the single source for shorthand expansion; `lib/webflow-converter/longhand.test.ts` now has 105 tests covering every branch (margin/padding/inset, border family, gap/overflow/place-*, flex/flex-flow, transition, font/list-style/outline, border-radius, global-keyword guard, and the dispatcher/isShorthand sweep added here).
- F020 (the validator mentioned in this feature's notes) can safely import `isShorthand` from this module now.
- Reference prototype for anything not yet ported: `~/Desktop/html-to-webflow/src/longhand.mjs` (includes `expandBackground`, `toStyleLess`, and grid/animation warning branches not yet in this repo).
