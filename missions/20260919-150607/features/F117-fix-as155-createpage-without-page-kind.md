# F117 — Fix AS-155: createPage action test with no page_kind

_Mission: 20260919-150607_ _Milestone: M8_ _Parent: F046_

## Problem

The test named AS-155 tests the **inverse** of the assertion: it supplies `page_kind: "cms"` and never calls the action without `page_kind`. 

Furthermore, `CreatePageInput` is `z.infer<typeof createPageSchema>` (the output type), so `page_kind` is **required** at the TypeScript type level — a real caller omitting it is a compile error, not just tolerated at runtime. The pre-existing f010 test works around this with `as never`.

## Fix

1. In `lib/validation/architecture.ts` (or wherever `CreatePageInput` is defined): change the exported type from `z.infer<typeof createPageSchema>` to `z.input<typeof createPageSchema>`, so that omitting `page_kind` is valid for callers (the schema's `.default("static")` handles it at runtime).

2. In `tests/unit/f046-create-page-schema-page-kind-optional.test.ts` (or add to the F046 test file):
   - Add a test that calls `createPage` server action with `{ name: "Page", slug: "page" }` and NO `page_kind`, asserting `result.success === true` and the row's `page_kind === "static"` 
   - Alternatively: test the schema directly with `createPageSchema.parse({ name: "Page", slug: "page" })` and assert the output has `page_kind: "static"` (this proves the default is applied)

3. Extend the AS-156 test to assert `result.data.page_kind === "static"` (not just `result.success`) so flipping the default is caught.

4. Run tests and tsc clean.

## Assertion covered

- AS-155: createPage without page_kind succeeds and defaults to "static"
- AS-156 (strengthen): default value is "static" specifically

## Clarified implementation

- Touches: `lib/validation/architecture.ts` (type export only), test files
- The `.default("static")` schema behaviour stays unchanged
- `CreatePageInput` type change: `z.infer` → `z.input` makes `page_kind` optional at call sites

## Definition of done

- AS-155 test calls the action/schema parse WITHOUT page_kind and asserts success + "static"
- `npx tsc --noEmit` exits 0 (especially check f010 AS-031 test no longer needs `as never`)
