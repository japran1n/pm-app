# F096: Fix AS-001/AS-059 — make userIds required in getCalendarBlocks

**Milestone:** M7 follow-up (scrutiny pass 2 FAIL)

## Problem

F090 extracted `buildBlockUserIds` as an identity wrapper (`return [...selectedUserIds]`) and tested that identity. The call site in `page.tsx` still passes `selectedUserIds` directly as 4th argument. The mutation "drop the 4th argument" still survives because `getCalendarBlocks` treats `userIds === undefined` as "no restriction", leaking all members' blocks.

Source-text policing does not work for this class of bug. The compile-time fix is to make `userIds` a **required** (non-optional) parameter in `getCalendarBlocks`.

## Fix

### Step 1 — Read the current signature

Read `lib/queries/calendar-blocks.ts`. Find the `getCalendarBlocks` function signature. The `userIds` parameter is currently optional (`userIds?: string[]` or `userIds: string[] | undefined`).

### Step 2 — Make userIds required

Change the signature so `userIds: string[]` is required (no `?`, no `| undefined`). Update the function body: if the parameter was conditionally skipped when undefined, now it is always filtered.

### Step 3 — Fix all call sites

Run `npx tsc --noEmit` to find any call sites that pass no `userIds`. Fix each one — they must pass an explicit array.

The primary call site is `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`. Verify it passes `selectedUserIds` (via `buildBlockUserIds(selectedUserIds)` from F090, or directly).

### Step 4 — Update the unit test

In `tests/unit/f031-page-layout-derivation.test.tsx`, ensure `test_AS_059_block_fetch_scoped_to_selection_not_all_members` still covers the data-flow. Also add a **type-level assertion**: call `getCalendarBlocks` without `userIds` → this must be a TypeScript compile error (`@ts-expect-error` confirms it).

```ts
it("test_AS_001_userIds_is_required_param", () => {
  // @ts-expect-error — userIds is required; omitting it must be a compile error
  getCalendarBlocks({ workspaceId: "w1" });
});
```

### Step 5 — Mutation verification

After making `userIds` required, verify:
- `npx tsc --noEmit` passes (0 errors)
- The @ts-expect-error test: if you revert the signature to optional, `@ts-expect-error` turns into a "Unused '@ts-expect-error' directive" error → test suite FAILS

### Step 6 — Gates

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run tests/unit/f031-page-layout-derivation.test.tsx
npx next build
```

Commit before exiting. Handoff at `missions/20260920-124226/handoffs/F096-handoff.md`.
