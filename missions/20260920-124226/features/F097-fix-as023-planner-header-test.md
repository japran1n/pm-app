# F097: Fix AS-023 — PlannerHeader position test must be distinct from AS-001

**Milestone:** M7 follow-up (scrutiny pass 2 FAIL)

## Problem

The scrutiny found that AS-023's test in `tests/unit/f031-page-layout-derivation.test.tsx` is `expect(resolvePlannerLayout(1)).toBe("week-grid")` — byte-identical to the AS-001 test. This means AS-023 has no distinct coverage.

AS-023 asserts: `<PlannerHeader>` is rendered above (before) the layout conditional in `page.tsx`, not inside either branch.

F094 added comment-stripping to an F088 test, but the AS-023 test in f031 was not updated.

## Fix

### Step 1 — Read the test file

Read `tests/unit/f031-page-layout-derivation.test.tsx`. Find the test tagged `AS-023` or any test about `PlannerHeader` position.

### Step 2 — Replace the vacuous test

Replace the `expect(resolvePlannerLayout(1)).toBe("week-grid")` assertion (or whatever identical-to-AS-001 assertion is there) with a source-text structural check that:

1. Reads `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`
2. Strips single-line comments (`//`) and multi-line comments (`/* ... */`)
3. Finds the index of `<PlannerHeader` in the stripped source
4. Finds the index of the layout conditional (e.g., `layout === "stacked"` or `layout === "week-grid"`)
5. Asserts `<PlannerHeader` index < layout conditional index
6. Asserts `<PlannerHeader` appears exactly once

Mutation to verify: move `<PlannerHeader .../>` inside the `if (layout === "stacked")` branch → the position check MUST FAIL.

### Step 3 — Gates

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run tests/unit/f031-page-layout-derivation.test.tsx
```

Commit before exiting. Handoff at `missions/20260920-124226/handoffs/F097-handoff.md`.
