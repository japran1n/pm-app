# F073: Fix AS-056 — "Just me" test must pin to selfId, not members[0]

**Milestone:** M6 follow-up 2 (scrutiny pass 2 blocker)

## Problem

All AS-056 "Just me" tests use fixtures where `selfId === members[0].userId`. Mutating the shortcut to `onSelectionChange([members[0]!.userId])` instead of `onSelectionChange([selfId])` survives all tests — the shortcut would return the wrong person when self is not first in the list.

## Fix

In `tests/unit/people-switcher.test.tsx` (the "Just me" test cases):

1. Use a fixture where `selfId` is NOT `members[0]` — e.g., `selfId = "member-c"` with members `["member-a", "member-b", "member-c"]`.
2. Click "Just me" → assert `onSelectionChange` was called with exactly `["member-c"]`, NOT `["member-a"]`.
3. Mutation: change `onSelectionChange([selfId])` to `onSelectionChange([members[0]!.userId])` in `people-switcher.tsx` → test MUST FAIL because `"member-a" !== "member-c"`.

## Gate

```bash
npx vitest run tests/unit/people-switcher.test.tsx
# Mutation: change [selfId] to [members[0]!.userId] in "Just me" handler → MUST FAIL
```
