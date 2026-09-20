# F119 — Fix AS-160: duplicate id guard in reorderComponents

_Mission: 20260919-150607_ _Milestone: M8_ _Parent: F047_

## Problem

`reorderComponentsSchema` uses a plain `z.array(z.string().uuid())` without a uniqueness constraint. `submittedIds` is compared against a `Set` of existing rows, so `[A, A, B]` against `{A, B}` satisfies size + membership checks, then writes `A→0, A→1, B→2` concurrently, leaving position 0 orphaned and A's final position nondeterministic.

## Fix

1. In `lib/validation/architecture.ts`, add a `.refine()` to `reorderComponentsSchema.componentIds` (or to the schema object) that checks `new Set(ids).size === ids.length`. Error message: "Component IDs must be unique".

2. In `lib/actions/architecture/components.ts`, as a defense-in-depth belt-and-suspenders, also compare `componentIds.length` against the DB row count (not just set membership) so that `[A, A, B]` would be rejected even if the schema refinement somehow passed.

3. Add tests in `tests/unit/m8-reorder-components.test.ts`:
   - "AS-160 duplicate ids are rejected" — pass `[A, A, B]` and assert `{ success: false }` with a descriptive error
   - "AS-160 foreign id rejected" — pass an id that doesn't belong to any row in the project

## Assertion covered

- AS-160: reorderComponents validates completeness and uniqueness

## Clarified implementation

- Touches: `lib/validation/architecture.ts`, `lib/actions/architecture/components.ts`, `tests/unit/m8-reorder-components.test.ts`
- The existing passing tests must still pass

## Definition of done

- `[A, A, B]` input returns `{ success: false }` with a clear error message
- tsc + lint clean
- New tests pass
