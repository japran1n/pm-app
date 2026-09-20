# F053: fix AS-026 — use visibility:private project + narrow try/catch

**Milestone:** M2 follow-up (M2-scrutiny-3 blocker)
**Estimated worker time:** 15 minutes
**Depends on:** F051

## Problem

`tests/integration/planner-block-rls.test.ts` has two issues:

### 1. AS-026 test seeds wrong project type

The test at `test_AS_026_member_can_read_block_attached_to_project_they_cannot_see`
inserts a project without `visibility`. The `projects.visibility` column is
`not null default 'workspace'` (migration 20260821140522_projects_visibility_column.sql).
A workspace-visible project is readable by all members under BOTH the old policy
and the new one — so the test would pass even if migration 20261128010001 were reverted.
Fix: add `visibility: "private"` to the project insert.

### 2. Over-broad try/catch swallows real RLS failures

The `try` block wraps the entire beforeAll including the member's own RLS-enforced
`calendar_blocks` insert. If `calendar_blocks_insert_visible` broke, the catch would
fire, set `skipDueToNetwork = true`, and all 8 tests would skip — hiding real failures.

Fix: narrow the catch to only network connectivity failures. Check for network error
indicators before setting the skip flag:

```ts
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED") || msg.includes("network")) {
    skipDueToNetwork = true;
    return;
  }
  throw e; // re-throw non-network errors so they surface as real failures
}
```

## Files
- `tests/integration/planner-block-rls.test.ts`

## Gate

```bash
npx tsc --noEmit   # must be clean
npx vitest run tests/integration/planner-block-rls.test.ts
# If Supabase reachable: all pass
# If not reachable (fetch failed): skip cleanly
```
