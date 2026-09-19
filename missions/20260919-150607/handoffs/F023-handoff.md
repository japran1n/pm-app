# Handoff: F023 — Singular actions decision

## Status
COMPLETE

## Assertions covered
AS-082: PASS — decision documented in code comment above `setDisciplineEstimate` in `lib/actions/architecture/estimates.ts`, plus a dedicated test file asserting the singular actions and the bulk action all remain exported/callable.

## Files changed
lib/actions/architecture/estimates.ts
tests/unit/f023-singular-actions-decision.test.ts

## Commands run
`npx vitest run tests/unit/f023-singular-actions-decision.test.ts` (0)
`npx vitest run` (0, 262/833 test files failing — all pre-existing failures unrelated to this change, e.g. `supabase.rpc is not a function` in `tests/unit/watching-feed-query.test.ts`; none reference F023, estimates, or discipline actions)

## Decisions made
- Grepped for callers of `setDisciplineEstimate` / `clearDisciplineEstimate` outside the popover and test files (`grep -rn` across `lib`, `components`, `app`). Found no current external callers beyond the barrel re-export in `lib/actions/architecture.ts`.
- Per the clarified spec's explicit decision, kept the singular actions anyway (not removed) even though no current caller exists, because they are being deliberately preserved as a supported single-discipline API surface for future callers (e.g. programmatic APIs, single-discipline UI flows). Added an explanatory comment directly above `setDisciplineEstimate` in `lib/actions/architecture/estimates.ts` stating they are non-deprecated and why.
- Wrote `tests/unit/f023-singular-actions-decision.test.ts` as the documentation-by-test artifact: asserts `setDisciplineEstimate`, `clearDisciplineEstimate` (from both the estimates module and the architecture barrel) and `setDisciplineEstimatesBulk` are all still exported functions, so an accidental future removal breaks this test and forces re-evaluation of the decision.

## Out-of-scope work needed
None identified for this feature.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Confirmed via grep that no callers of the singular actions exist outside the popover/tests before finalizing the "keep" decision, per the spec's instruction to check callers first even though the clarified answer already directed keeping them.

## Notes for the next worker
No MCP tools were needed for this feature — it is a pure code-documentation task with no external service or live schema involved.
