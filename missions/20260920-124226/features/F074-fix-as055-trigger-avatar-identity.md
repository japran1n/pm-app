# F074: Fix AS-055 — trigger avatars must depict the actual selection

**Milestone:** M6 follow-up 2 (scrutiny pass 2 major)

## Problem

AS-055 tests only count avatar elements; they don't verify the avatars match the selected members. `initialsFor(selectedMembers[0])` instead of `initialsFor(member)` — all trigger avatars become the same person — survives all tests.

All AS-055 fixtures use `avatarUrl: null`, so the `<img src=...>` branch is untested.

## Fix

In `tests/unit/people-switcher-multiselect.test.tsx`:

1. Add a test with a fixture where at least one member has a non-null `avatarUrl` (e.g., `{ userId: "alice", name: "Alice", avatarUrl: "https://example.com/alice.jpg" }`). Select Alice. Assert the trigger contains an `<img>` with `src="https://example.com/alice.jpg"`.

2. Add a test that selects members `[alice, bob]` (both with null avatarUrl and distinct initials — e.g., "A" and "B") and asserts the trigger avatars show "A" and "B" (both initials are present). Mutation: `initialsFor(selectedMembers[0])` for both → only "A" appears twice → test fails.

3. Mutation to verify: change `initialsFor(member)` to `initialsFor(selectedMembers[0]!)` in the trigger render → test MUST FAIL.

## Gate

```bash
npx vitest run tests/unit/people-switcher-multiselect.test.tsx
# Mutation: all trigger avatars use selectedMembers[0] initials → MUST FAIL
```
