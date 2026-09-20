# Handoff: F091 — Fix AS-015: strengthen ?view= guard

## Status
COMPLETE

## Assertions covered
AS-015: PASS — replaced the weak `/\bview\s*:\s*string/` regex-only check with a type assertion (searchParams Promise type + destructuring must not include `view`), a usage assertion (the `resolvePlannerLayout(...)` call site must not reference `view` and must pass `selectedUserIds.length`), and a structural/type-level test that `resolvePlannerLayout` only accepts a `number` (a `@ts-expect-error` line proves a string argument does not type-check).

## Files changed
tests/unit/f031-page-layout-derivation.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint tests/unit/f031-page-layout-derivation.test.tsx --max-warnings=0` (0)
`npx vitest run tests/unit/f031-page-layout-derivation.test.tsx` (0, 14 passed)

## Decisions made
- Kept the original three regex checks in `test_AS_015_page_source_does_not_reference_searchParams_view` as-is (they still hold value) and added new, stricter tests alongside rather than replacing them, since the spec asked for the guard to be strengthened, not narrowed.
- The type assertion checks both the `searchParams: Promise<{...}>` type annotation (no `view?: string` field, order-independent) and the `const { ... } = await searchParams;` destructuring (no bound `view` variable) — this satisfies the spec's requirement #1 in a way that survives field reordering.
- The usage assertion extracts the exact argument list passed to `resolvePlannerLayout(...)` via regex capture and asserts it neither contains `view` nor omits `selectedUserIds.length` — stronger than a substring "not contains" check against the whole file, since it's scoped to the call site itself.
- For the structural test (spec's #3), rather than asserting on `resolvePlannerLayout`'s runtime behavior with a string argument (which is unreliable — JS coerces `"stacked" <= 1` to `false ? "week-grid" : "stacked"`, so a naive runtime check of `resolvePlannerLayout("stacked") !== "stacked"` is not actually falsifiable and initially produced a false failure in my own draft), I used a `@ts-expect-error` compile-time check: calling `resolvePlannerLayout("stacked")` must fail to type-check under the current `number`-only signature. If a mutation widens the parameter type to accept a view-like string, this line starts type-checking and the `@ts-expect-error` directive itself becomes a TypeScript error (`--noEmit` gate catches it), which is the intended failure signal described in the mutation scenario.
- Verified the mutation scenario manually: with the current signature `resolvePlannerLayout(selectionCount: number)`, `resolvePlannerLayout("stacked")` is a TS2345 type error, so `@ts-expect-error` is required and correctly suppresses it. Widening the signature to accept a string would remove that error, causing `@ts-expect-error` to itself fail (`ts(2578)`), which fails `npx tsc --noEmit` — satisfying "the structural test must fail" from the mutation description at the type-check gate rather than at runtime.

## Out-of-scope work needed
None. Note: at commit time `git status` showed unrelated in-flight modifications to `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`, `lib/calendar/workspace-members.ts`, and two other test files (`f032-stacked-shell.test.tsx`, `f035-stacked-reorder.test.tsx`) — these are from a concurrent feature (appears to be F090, `buildBlockUserIds`) already present on disk before this worker started and were left untouched/uncommitted by this worker, per "Do not modify files outside the scope listed in your feature spec."

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used a TypeScript `@ts-expect-error` compile-time check instead of a runtime behavioral check for the "structural test" (spec item #3), because the naive runtime check (`resolvePlannerLayout("stacked")` compared against `"stacked"`) is not reliably falsifiable due to JS's `<=` coercion on non-numeric strings producing `"stacked"` as output for reasons unrelated to any `view` handling. The type-level check is strictly stronger: it fails at `tsc --noEmit` (an explicit CI gate for this feature) the moment the function's signature is widened to accept anything beyond `number`.

## Notes for the next worker
- The page source at `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` currently destructures `{ week: weekParam, people: peopleParam } = await searchParams` and calls `resolvePlannerLayout(selectedUserIds.length)` — both are what the new AS-015 tests pin down.
- No MCP usage — this is a pure test-file change against existing local source; nothing touches external service state.
