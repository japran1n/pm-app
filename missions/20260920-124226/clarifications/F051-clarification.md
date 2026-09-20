# F051 clarification

## Clarified implementation

### 1. Find the projects table schema first
Before writing the test, read `supabase/migrations/` to find column names for the
`projects` table (likely: id, workspace_id, name, slug; check for required fields).

### 2. Add createdProjectIds cleanup array
In `afterAll`, delete any projects created. Order: blocks first, then members, then
projects, then workspaces.

### 3. The discriminating test
The test must insert a block with a real non-null `project_id`. The block is owned by
`memberUserId`. `otherClient` is a workspace member with no project membership. Under
the new workspace-wide SELECT policy, `otherClient` must still see the block.

### 4. Network graceful skip
Wrap `beforeAll` body in try/catch. On catch, set `let networkFailed = true` at module
scope. In each `it(...)` test, add at the top: `if (networkFailed) return;` — vitest
treats a test that returns early as passing-vacuously, which is acceptable. Better
alternative: use `ctx.skip()` from vitest's test context. Exact approach: the simpler
the better.

Actually the cleanest approach: add a connection pre-check before `adminClient` usage:
```ts
let haveNetworkConnectivity = false;
beforeAll(async () => {
  try {
    await adminClient.from("workspaces").select("id").limit(1);
    haveNetworkConnectivity = true;
  } catch {
    // skip all tests below
    return;
  }
  // ... rest of beforeAll
});
```
Then wrap each test with a skip condition at the top.

## Definition of done
- New `test_AS_026_member_can_read_block_attached_to_project_they_cannot_see` test exists
- When network is unavailable: `vitest run tests/integration/planner-block-rls.test.ts` exits cleanly (no FAIL status)
- `npx tsc --noEmit` clean
- Commit made
