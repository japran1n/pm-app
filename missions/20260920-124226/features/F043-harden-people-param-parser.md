# F043: harden parsePeopleParam — normalisation and invariants

**Milestone:** M1 — Pure logic (follow-up from M1-scrutiny-1)
**Estimated worker time:** 30 minutes
**Depends on:** F002, F003

## Assertion IDs covered
- AS-004: `?people=all` resolves to every active member
- AS-008: when every id is invalid, fall back to selfId (never return empty array)

## Fixes
1. Trim raw value before `=== "me"` / `=== "all"` comparisons — `" all "` and `"all,"` should behave as `all`.
2. After resolving `all`, if `activeMemberIds` is empty, return `[selfId]` (never `[]`).
3. Validate selfId against activeMemberIds on the final fallback path — if selfId is not active, still return it (caller's responsibility) but document this.
4. Add a non-adjacent duplicate test: `["a","b","a"]` → `["a","b"]` to strengthen AS-010.

## Files
- lib/calendar/people-selection.ts
- tests/unit/planner-people-selection.test.ts
