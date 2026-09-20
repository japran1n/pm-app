# F082: Fix AS-053 — falsifiable type-to-filter test

**Milestone:** M6 follow-up 6 (scrutiny pass 6 major)
**Estimated worker time:** 15 minutes

## Problem

The AS-053 filter test has one positive and one negative case, but cmdk's default matcher is an opaque substring match. A prefix-only or case-sensitive filter survives because the test input happens to work with both. The test cannot detect "filtering is broken" vs "filtering works differently."

## Fix

In `tests/unit/people-switcher.test.tsx` (or multiselect test), add cases that only pass under substring, case-insensitive filtering:

1. Type "ice" (substring of "Alice", not a prefix) → Alice must remain visible, Bob must be hidden
2. Type "ALICE" (uppercase) → Alice must remain visible (case-insensitive)
3. Type "xyz" (no match) → no member rows visible, "No members found" or empty list

Mutation: change the filter to prefix-only (`member.name.toLowerCase().startsWith(query.toLowerCase())`) → case 1 ("ice") must fail (Alice hidden).

Also: assert the filter actually hides non-matching items, not just that they "exist" in the DOM with hidden=true.

## Gate

```bash
npx vitest run tests/unit/people-switcher.test.tsx
# Mutation: prefix-only filter → substring test MUST FAIL
```
