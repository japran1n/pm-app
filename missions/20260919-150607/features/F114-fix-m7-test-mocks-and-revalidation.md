# F114 — Fix M7 test mocks: record filter tuples + assert revalidatePath

_Mission: 20260919-150607_ _Milestone: M7 follow-up (scrutiny-1 FU-1+FU-2+FU-6 blockers)_

## Problem

`tests/unit/m7-change-page-slug.test.ts` has vacuous mocks:
- `eq`/`is`/`neq` stubs record nothing — deleting `.eq("project_id", …)` from uniqueness check (making it global) still passes AS-141
- Update mock captures only the value, not the column — a cascading `.eq("project_id", taskId)` update passes AS-144/AS-146
- `revalidatePath` is mocked but never asserted — deleting `revalidatePath` call passes AS-149

Also: `changePageSlugSchema.slug` missing `.trim()` vs `createPageSchema.slug`, stale TODO comment at pages.ts:1075-1081.

## Fix

### 1. Rewrite chainable mock builder in `tests/unit/m7-change-page-slug.test.ts`

Replace the `buildSelectChain` helper with one that records all filter tuples:

```typescript
function buildFilterChain(opts: { returnData: unknown; returnError?: unknown }) {
  const filters: Array<[string, unknown]> = [];
  const chain: Record<string, unknown> = {};
  const terminus = { data: opts.returnData, error: opts.returnError ?? null };
  
  const addFilter = (col: string, val: unknown) => {
    filters.push([col, val]);
    return chain;
  };
  
  chain.eq = vi.fn((col: string, val: unknown) => { filters.push([`eq:${col}`, val]); return chain; });
  chain.neq = vi.fn((col: string, val: unknown) => { filters.push([`neq:${col}`, val]); return chain; });
  chain.is = vi.fn((col: string, val: unknown) => { filters.push([`is:${col}`, val]); return chain; });
  chain.maybeSingle = vi.fn(() => terminus);
  chain.single = vi.fn(() => terminus);
  chain._filters = filters;  // expose for assertions
  return chain;
}
```

For the UPDATE mock, capture BOTH the payload AND the filter column:
```typescript
const updateFilters: Array<[string, unknown]> = [];
const updateMock = vi.fn().mockReturnValue({
  eq: vi.fn((col: string, val: unknown) => {
    updateFilters.push([col, val]);
    return { data: null, error: null };
  }),
  error: null,
});
```

### 2. Fix AS-141 test — assert filter columns

The "different project" test must prove the filter IS project_id-scoped:
```typescript
it("AS-141: uniqueness check is project_id-scoped", async () => {
  // Setup: unique chain records filters
  // Call changePageSlug(taskId, "my-new-slug")
  // Assert: the uniqueness SELECT chain includes:
  expect(uniquenessChain._filters).toContainEqual(["eq:project_id", "proj-id-1"]);
  expect(uniquenessChain._filters).toContainEqual(["eq:page_slug", "my-new-slug"]);
  expect(uniquenessChain._filters).toContainEqual(["neq:id", taskId]);
  expect(uniquenessChain._filters).toContainEqual(["is:deleted_at", null]);
});
```

### 3. Fix AS-144/AS-146 tests — assert update column

```typescript
// Assert the update is scoped by id, not project_id
expect(updateFilters).toContainEqual(["id", taskId]);
expect(updateFilters).not.toContainEqual(["project_id", expect.anything()]);
```

### 4. Fix AS-149 — assert revalidatePath called

```typescript
import { revalidatePath } from "next/cache";
// ... in success test:
expect(revalidatePath).toHaveBeenCalledWith("/w", "layout");
// ... in failure tests (unauthenticated, viewer, duplicate, etc.):
expect(revalidatePath).not.toHaveBeenCalled();
```

### 5. Fix `changePageSlugSchema.slug` — add `.trim()`

In `lib/validation/architecture.ts`, add `.trim()` to `changePageSlugSchema.slug`:
```typescript
slug: z.string().trim().min(1, "...").max(200, "...").regex(slugPattern, "..."),
```

Add a test in `tests/unit/m7-change-page-slug-schema.test.ts` for AS-140:
```typescript
it("AS-140: trims whitespace before validation", () => {
  expect(changePageSlugSchema.safeParse({ taskId: validUuid, slug: "  my-page  " }).success).toBe(true);
  expect(changePageSlugSchema.parse({ taskId: validUuid, slug: "  my-page  " }).slug).toBe("my-page");
});
```

### 6. Delete stale TODO comment at pages.ts:1075-1081

Find and delete the `TODO(F042): changePageSlug server action lands here` block.

## Assertions: AS-141, AS-144, AS-146, AS-149, AS-140

## Verification
```
npx vitest run tests/unit/m7-change-page-slug.test.ts tests/unit/m7-change-page-slug-schema.test.ts --reporter=verbose 2>&1
npx tsc --noEmit 2>&1 | head -10
```

## Commit
`test(F114): fix M7 mocks — record filter tuples + assert revalidatePath [AS-141, AS-144, AS-146, AS-149, AS-140]`

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>

## Handoff
`missions/20260919-150607/handoffs/F114-handoff.md`
