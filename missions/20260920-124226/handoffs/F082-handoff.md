# Handoff: F082 — Fix AS-053 falsifiable type-to-filter test

## Status
COMPLETE

## Assertions covered
AS-053: PASS — added `test_AS_053_filter_matches_substring_not_just_prefix` (types "ovelace", a substring of "Ada Lovelace" but not a prefix of any word in it) and `test_AS_053_filter_is_case_insensitive` (types "ADA LOVELACE" uppercase). Both assert Ada's row is present via `getByText` and Grace's row is absent via `queryByText(...).not.toBeInTheDocument()`, i.e. actually removed from the DOM, not merely `hidden`. Existing `test_AS_053_typing_narrows_the_listed_members` and `test_AS_053_typing_a_query_matching_nobody_shows_the_empty_state` kept unchanged.

## Files changed
tests/unit/people-switcher.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint tests/unit/people-switcher.test.tsx --max-warnings=0` (0)
`npx vitest run tests/unit/people-switcher.test.tsx` (0) — 10/10 tests passed

## Decisions made
- Used "ovelace" as the substring query instead of the spec's example "ice" because the fixture members in this file are "Ada Lovelace" / "Grace Hopper" (not Alice/Bob as in the spec prose). "ovelace" is a substring of "Lovelace" but is not a prefix of "Ada", "Lovelace", or "Ada Lovelace", so it still falsifies a prefix-only filter (`name.toLowerCase().startsWith(query.toLowerCase())`) while passing under cmdk's real substring match. Preserves the spec's intent (AS-053: falsify prefix-only and case-sensitive implementations) against the actual fixture data in this file.
- Did not add the third spec-suggested case (query matching nobody) as a *new* test because it already exists verbatim as `test_AS_053_typing_a_query_matching_nobody_shows_the_empty_state` in this file — duplicating it would be redundant.
- Left `people-switcher-multiselect.test.tsx` untouched; the spec says "or multiselect test, wherever the filter test lives" — the canonical AS-053 filter tests live in `people-switcher.test.tsx` per that file's own header comment ("F026 (AS-052, AS-053) ... shell behaviour F026 owns"), so that is where the new cases belong.

## Out-of-scope work needed
None identified.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Substituted "ice"/"Alice"/"Bob" from the spec's illustrative example with "ovelace"/"Ada Lovelace"/"Grace Hopper" to match this file's actual fixture data, while preserving the exact substring-not-prefix and case-insensitivity properties the spec requires.

## Notes for the next worker
Mutation that would break the new tests: changing the cmdk filter behaviour (or wrapping `CommandInput`/`CommandItem` with a custom `filter` prop) to prefix-only matching, e.g. `member.name.toLowerCase().startsWith(query.toLowerCase())`, would make `test_AS_053_filter_matches_substring_not_just_prefix` fail because "ovelace" is not a prefix of "Ada Lovelace" — Ada's row would incorrectly disappear. A case-sensitive filter would make `test_AS_053_filter_is_case_insensitive` fail because "ADA LOVELACE" (uppercase) would not match "Ada Lovelace" (mixed case) under exact-case substring matching.
