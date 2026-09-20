# F051: add AS-026 RLS test — block on private project is still readable

**Milestone:** M2 follow-up (M2-scrutiny-2 FU-B)
**Estimated worker time:** 25 minutes
**Depends on:** F011 (planner-block-rls.test.ts exists)

## Assertion IDs covered
- AS-026: a calendar block attached to a project the viewer cannot otherwise see is still readable by any active member of that workspace

## Problem

`tests/integration/planner-block-rls.test.ts` seeds all blocks with `project_id = NULL`.
The OLD SELECT policy had an `is_project_visible_to` branch AND a null-project_id branch.
The new policy (`is_active_workspace_member`) is simpler — but since every test uses
`project_id = NULL`, the old policy would also pass all existing tests. The widening is
completely untested and unfalsifiable.

## Fix

Add one new test case to the RLS suite:

1. In `beforeAll`, also create a `projects` table row (or whatever the projects table is
   called), then a second calendar block owned by `memberUserId` with `project_id` pointing
   to that project.
2. The `otherClient` (a workspace member who is NOT a member of the project) should still
   be able to read the block.
3. Assert: `data` contains the block id, and `data[0].title` equals the original title
   (NOT "Busy" — AS-027 also covered).

```ts
it("test_AS_026_member_can_read_block_attached_to_project_they_cannot_see", async () => {
  // seed a project that only memberUserId owns (otherClient has no access)
  const { data: project } = await adminClient
    .from("projects")
    .insert({ workspace_id: workspaceId, name: "Private Project", ... })
    .select("id").single();
  createdProjectIds.push(project.id);

  const { data: block } = await memberClient
    .from("calendar_blocks")
    .insert({
      workspace_id: workspaceId,
      user_id: memberUserId,
      project_id: project.id,
      title: "Block on private project",
      starts_at: "2026-09-23T09:00:00.000Z",
      ends_at: "2026-09-23T10:00:00.000Z",
    })
    .select("id").single();
  createdBlockIds.push(block.id);

  // otherClient is a workspace member but NOT a project member
  const { data, error } = await otherClient
    .from("calendar_blocks")
    .select("id, title")
    .eq("id", block.id);

  expect(error).toBeNull();
  expect(data?.map(r => r.id)).toContain(block.id);
  expect(data?.[0]?.title).toBe("Block on private project");
});
```

## Also fix: graceful skip on network failure

Currently `beforeAll` throws with `fetch failed` when Supabase is unreachable,
which causes vitest to report the entire suite as FAIL (7 skipped but file red).
The `describe.skipIf(!haveAdminCreds)` guard covers missing credentials but not
network failure.

Wrap the `beforeAll` body in try/catch and set a module-level `skipDueToNetwork`
flag, then use `beforeEach(() => { if (skipDueToNetwork) ctx.skip() })` — or use
vitest's `onTestFailed` / check pattern — so network failure produces a clean SKIP
(not a FAIL).

Alternatively: check if `SUPABASE_URL` is reachable with a short timeout before
running `beforeAll`, and if not, call `vi.stubGlobal` / `ctx.skip()`.

## First: check the projects table schema

Read `supabase/migrations/` to find the projects table creation migration and get
the required column names. The insert above is pseudocode — adapt to the real schema.

## Files

- `tests/integration/planner-block-rls.test.ts`

## Gate

```bash
npx vitest run tests/integration/planner-block-rls.test.ts
```
Must either:
- PASS all tests (when Supabase reachable), OR
- SKIP all tests cleanly with no FAIL status (when Supabase unreachable)

Must NOT show "FAIL" when the only reason is network unavailability.
