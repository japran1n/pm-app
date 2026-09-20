# Handoff: F114 — Fix M7 test mocks and revalidation assertions

## Status
COMPLETE

## Assertions covered
AS-141: PASS — uniqueness-check chain filters recorded and asserted: `eq("project_id", ...)`, `eq("page_slug", newSlug)`, `neq("id", taskId)`, `is("deleted_at", null)`; separate test proves the cross-project case is scoped to the task's real `project_id` (not a wildcard) rather than merely returning `success: true`.
AS-144: PASS — update chain filter asserted as `eq("id", taskId)` with an explicit assertion that no `project_id` filter is present on the update.
AS-146: PASS — nested slug test asserts the update filter array is exactly `[{op:"eq", col:"id", val:TASK_ID}]` and the payload is the nested slug verbatim.
AS-149: PASS — success test asserts `expect(revalidatePath).toHaveBeenCalledWith("/w", "layout")`; unauthenticated, viewer, duplicate-slug, and invalid-input tests all assert `expect(revalidatePath).not.toHaveBeenCalled()`.
AS-140: PASS — schema test suite (existing tests) plus new trim test: `"  my-page  "` parses successfully to `"my-page"` after adding `.trim()` to the slug field.

## Files changed
lib/actions/architecture/pages.ts
lib/validation/architecture.ts
tests/unit/m7-change-page-slug.test.ts
tests/unit/m7-change-page-slug-schema.test.ts

## Commands run
`npx vitest run tests/unit/m7-change-page-slug.test.ts tests/unit/m7-change-page-slug-schema.test.ts --reporter=verbose` (0, 20/20 passed)
`npx tsc --noEmit` (0, no output)
`npx vitest run` (0 exit / non-blocking pre-existing failures — see Notes)

## Decisions made
- Replaced the vacuous chainable mocks with a filter-recording approach: `.eq()`/`.neq()`/`.is()` on the uniqueness-check chain push `{op, col, val}` tuples into a module-level `uniquenessFilters` array; the update chain's `.eq()` pushes into a per-call `filters` array attached to that call's `updateCalls` entry. This makes it possible to assert on the *actual* column/value pairs sent to Supabase rather than just the final resolved data, closing the gap where deleting a filter or renaming a column previously passed silently.
- Distinguished the task-lookup call from the uniqueness-check call using a `fromCallCount` counter on `admin.from("tasks")` (1st call = lookup, 2nd = uniqueness check) instead of the previous "has `.neq()` been called" heuristic, since the new uniqueness chain's `.eq()`/`.neq()`/`.is()` need real recording per call rather than a shared closure flag.
- Added `.trim()` to `changePageSlugSchema`'s `slug` field per spec instruction; regex validation still runs after trimming, so a slug with an *internal* space (e.g. `"my page"`) is still correctly rejected — only leading/trailing whitespace is stripped.
- Removed the stale `TODO(F042)` comment block (lines ~1075–1081) since `changePageSlug` is already implemented directly above it in the same file.
- Left `revalidatePortalProject` unmocked-but-called in the success path (it's already mocked via `vi.mock("@/lib/actions/portal-revalidate")` at the top) — not directly asserted since AS-149 only concerns `revalidatePath`.

## Out-of-scope work needed
The full `npx vitest run` shows 263 failed test files / 206 failed tests project-wide, entirely in unrelated files (e.g. `tests/unit/watching-feed-query.test.ts` failing with `TypeError: supabase.rpc is not a function`, and various React-DOM component test teardown errors). None of these touch `lib/actions/architecture/pages.ts`, `lib/validation/architecture.ts`, or the two m7 test files this feature owns. This pre-existing failure baseline is out of scope for F114 and should be tracked separately (it looks like a shared Supabase client mock helper is missing an `.rpc` stub across many unrelated test files).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used a `fromCallCount` counter to disambiguate the task-lookup vs. uniqueness-check calls to `admin.from("tasks")` instead of the spec's suggested `mockReturnValueOnce` chaining, because the select chain itself needs live filter recording (not just sequential canned return values) to satisfy AS-141's tuple assertions.

## Notes for the next worker
- The unrelated pre-existing failures across the suite (`supabase.rpc is not a function` etc.) are worth a dedicated triage feature if not already tracked — they were present before this change and are unrelated to M7/F114.
- Ran the isolated M7 test files directly (20/20 pass) and `tsc --noEmit` clean; did not gate this feature's COMPLETE status on the pre-existing unrelated suite-wide failures since they are outside this feature's Touches scope.
