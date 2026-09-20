# F115: Fix AS-063 — fixture members order must differ from selectedUserIds

**Milestone:** M7 follow-up (scrutiny pass 8 FAIL)

## Problem

AS-063 asserts stacked rows appear in `?people=` URL param order, not roster/alphabetical order. The current fixture has `members` in the same order as `selectedUserIds` — so the test can't distinguish URL order from roster order. Sorting selectedUserIds alphabetically gives the same result.

## Fix

### Step 1 — Find the AS-063 test

Read `tests/unit/f032-stacked-shell.test.tsx` (or wherever AS-063 is tested). Find the fixture.

### Step 2 — Make members order conflict with selectedUserIds

The members roster must be in alphabetical order (or some order different from the selectedUserIds param order):

```ts
// selectedUserIds in URL param order (non-alphabetical — carol before alice)
const selectedUserIds = ["carol-id", "alice-id", "bob-id"];

// members in roster/alphabetical order (different from URL order)
const members = [
  { userId: "alice-id", name: "Alice", avatarUrl: null }, // alphabetical first
  { userId: "bob-id", name: "Bob", avatarUrl: null },
  { userId: "carol-id", name: "Carol", avatarUrl: null }, // alphabetical last
];

// Expected DOM order: carol, alice, bob (URL param order)
// Not: alice, bob, carol (alphabetical order)
```

The test then asserts: row 1 = carol, row 2 = alice, row 3 = bob.

Mutation: sort `selectedUserIds` alphabetically before rendering → carol would be last → test MUST FAIL.

### Step 3 — Gates

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run tests/unit/f032-stacked-shell.test.tsx
```

Commit before exiting. Handoff at `missions/20260920-124226/handoffs/F115-handoff.md`.
