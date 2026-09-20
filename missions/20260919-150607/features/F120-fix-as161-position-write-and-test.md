# F120 — Fix AS-161: harden position write and tighten test

_Mission: 20260919-150607_ _Milestone: M8_ _Parent: F047_

## Problem

Two independent defects:

(a) The test in `tests/unit/m8-reorder-components.test.ts` asserts only `update()` payload `{position: N}` and never the `.eq(id)` argument — writing positions in DB order instead of the caller-submitted order would still pass. The test doesn't prove id↔position pairing.

(b) The write is `Promise.all` of N independent `update().eq(id)` calls with no transaction. A mid-batch failure leaves a partial reorder committed with no rollback.

## Fix

### (a) Test fix
Change the mock in `m8-reorder-components.test.ts` so it records `(id, position)` tuples from both the `.eq(id)` argument AND the `update({position})` payload. Assert the exact pairing: each submitted id gets the position matching its index in the submitted array, not DB order.

Pattern: use the same filter-recording mock pattern from `m7-change-page-slug.test.ts` (which records `{op, col, val}` tuples for every `.eq()` call).

### (b) Production fix
Replace the `Promise.all` fan-out with one of:
- A Supabase upsert of the full ordered set in a single query
- Or if the current pattern must stay, add a defensive `.eq("project_id", projectId)` to each update call to prevent cross-project position writes

The simplest atomic approach: `supabase.from("page_components").upsert(componentIds.map((id, i) => ({ id, position: i, project_id: projectId })))` — this is atomic at the DB level.

## Assertion covered

- AS-161: successful call updates every component's position to its index in the submitted order (not DB order)

## Clarified implementation

- Touches: `lib/actions/architecture/components.ts`, `tests/unit/m8-reorder-components.test.ts`
- The upsert approach requires all relevant non-null columns on `page_components` to be included — check the table schema first

## Definition of done

- Mock records (id, position) pairs and test asserts exact pairing
- Writing in DB order instead of submitted order fails the test
- tsc + lint clean
