# F050: make AS-058 sort falsifiable (fixture inversion + tie-break)

**Milestone:** M1 follow-up (M1-scrutiny-3 FU-13)
**Estimated worker time:** 25 minutes
**Depends on:** F007 (orderPeopleForWholeTeam)

## Assertion IDs covered
- AS-058: members sorted alphabetically, self first, nulls last

## Problem

The current test fixtures for `orderPeopleForWholeTeam` in
`tests/unit/planner-people-selection.test.ts` are id-alphabetically co-ordered
with their names. Replacing the entire comparator body with
`a.id.localeCompare(b.id)` — ignoring `name` entirely — leaves all five AS-058
tests green. The suite cannot distinguish sort-by-name from sort-by-id.

Additionally, `localeCompare(..., "en", {sensitivity:"base"})` returns `0` for
case/accent ties (`bob`/`Bob`, `Arla`/`Ärla`), so the sort is not total — output
order depends on input row order, which is undefined from a DB query.

## Fix

### 1. Invert the test fixtures so id order disagrees with name order

Replace existing fixtures with ones where the alphabetically-correct name order
is the **reverse** of the id order:

```ts
// id order: "zz" > "aa", but name order: "Alice" < "Bob"
// → correct output must be by name: ["zz","aa"], NOT by id: ["aa","zz"]
const members = [
  { id: "zz", name: "Alice" },
  { id: "aa", name: "Bob" },
];
// selfId = "other-self" (not in list, or omit self from this group)
// expected: ["zz", "aa"]  (Alice before Bob)
```

Apply the same principle to the null-name and locale cases.

### 2. Make the sort total (tie-break to prevent input-order dependency)

After `localeCompare` returns `0`, break ties by:
1. Raw string compare on `name` (catches case/accent ties): `a.name < b.name ? -1 : a.name > b.name ? 1 : 0`
2. Then by `id` as a final tiebreaker

This ensures `{bob}` and `{Bob}` always produce the same output regardless of input order.

### 3. Update tests to pin both orderings

For each case where `localeCompare` returns `0` (e.g. `Arla`/`Ärla`):
- Run the test with members in both input orders
- Assert both produce the SAME output (proving total order)

### 4. Clarification file

Write the approach in `missions/20260920-124226/clarifications/F050-clarification.md`.

## Files

- `lib/calendar/people-selection.ts` — add tie-breaking to sort comparator
- `tests/unit/planner-people-selection.test.ts` — invert fixtures, add input-order invariant tests

## Gate

Mutation test: replacing the comparator body with `return a.id.localeCompare(b.id)`
must cause at least one test to fail (verifiable by temporarily making that change
and running the test suite).

`npx vitest run tests/unit/planner-people-selection.test.ts` must pass.
`npx tsc --noEmit` must be clean.
