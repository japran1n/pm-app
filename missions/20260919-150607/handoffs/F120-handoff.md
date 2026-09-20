# Handoff: F120 — Fix AS-161: harden position write and tighten test

## Status
COMPLETE

## Assertions covered
AS-161: PASS — new test writes a submitted order that deliberately differs from DB row order (COMP_3, COMP_1, COMP_2 vs DB order COMP_1, COMP_2, COMP_3) and asserts exact (id, position) pairing via a Map built from the recorded upsert payload; production code now writes via a single atomic upsert instead of Promise.all of independent updates.

## Files changed
lib/actions/architecture/components.ts
tests/unit/m8-reorder-components.test.ts

## Commands run
`npx vitest run tests/unit/m8-reorder-components.test.ts --reporter=verbose` (0, 5/5 pass)
`npx tsc --noEmit` (0)
`npx eslint lib/actions/architecture/components.ts --max-warnings=0` (0)
`npx vitest run tests/unit` (nonzero — 9 pre-existing unrelated failures in other files, e.g. tests/unit/watching-feed-query.test.ts "supabase.rpc is not a function"; none touch page_components/reorderComponents; not caused by this change)

## Decisions made
- Replaced the `Promise.all` fan-out of N `update().eq(id)` calls with a single `admin.from("page_components").upsert(rows, { onConflict: "id" })` call — atomic at the DB level, matching the clarified spec's preferred approach.
- The generated Supabase Insert type for `page_components` requires `name` and `project_id` as non-optional fields even on an upsert whose `onConflict: "id"` always resolves to an UPDATE here (every id was already confirmed to exist for this project by the completeness check above). To satisfy TypeScript without a type-cast/`as any` escape hatch, the `select` that loads `existingComponents` was widened from `id` to `id, name, project_id`, and those values are carried through unchanged into each upsert row alongside the new `position`. This does not change behavior (RLS/ownership already re-verified, and `name`/`project_id` are unchanged values echoed back), it only satisfies the type contract.
- Did not add a defensive `.eq("project_id", projectId)` (that was the fallback option for the fan-out approach) since the upsert path was used instead, per the spec's stated preference ("prefer the upsert").
- Test: extended the mock's `page_components` table stub to expose `upsert` (replacing the old `update`) and record each call's `(rows, options)` into an array, then assert `onConflict: "id"` and the exact id→position mapping via a `Map`, independent of array order — this fails if positions were written in DB order (COMP_1→0, COMP_2→1, COMP_3→2) instead of the submitted order (COMP_3→0, COMP_1→1, COMP_2→2).

## Out-of-scope work needed
- The full `tests/unit` suite has ~9 pre-existing failing test files unrelated to this feature (e.g. `watching-feed-query.test.ts`, others in the `[10/30]`/`[11/30]` output) due to a `supabase.rpc is not a function` mock gap. Not touched here per scope; flagging for whichever feature owns `lib/queries/watching.ts` test mocks.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Included `name`/`project_id` (unchanged, fetched values) in the upsert payload purely to satisfy the generated Supabase Insert type's required fields for `page_components`, since the spec's example upsert call (`{ id, position }` only) does not type-check against the DB-generated types in this repo. Chose to widen the existing `existingComponents` select query (already run right before this point in the function) rather than issue a second query or use a type assertion, keeping the fix in one round-trip and fully typed.

## Notes for the next worker
- No MCP tools were needed — this is a pure application-logic + unit-test fix; the `page_components` NOT NULL columns (`name`, `project_id`) were confirmed by reading `supabase/migrations/20261121010000_f002_page_components.sql`, not via live MCP introspection.
- `tests/unit/m7-change-page-slug.test.ts` was consulted as the reference filter-recording pattern per the spec but was not modified.
- `tests/unit/f048-component-panel-dnd.test.tsx` was intentionally left untouched per instructions (owned by another worker).
