# F055: Fix AS-030 — rebase switcher test on schema-producible states

**Milestone:** M3 follow-up (M3-scrutiny-1 blocker)
**Estimated worker time:** 20 minutes
**Depends on:** F014

## Problem

`tests/unit/switcher-member-source.test.ts` uses `status: "removed"` in its
exclusion fixture. The schema `workspace_members_status_check` only allows
`'invited'` and `'active'`. Removal is a row DELETE; there is no deactivated
state. The mutation `r.status === "active"` → `r.status !== "removed"` survives
all 3 tests (equivalent to no filter in production). The test proves nothing.

## Fix

Redesign the exclusion fixture to use **schema-producible states**:

1. An **absent member** (no row in the mock data) — proves the function only
   shows people present in the query result.
2. An **`invited` row that has a backfilled `user_id`** — this is the real
   production leak vector: an invited user who accepted but whose status was not
   updated. They must NOT appear in `result.active`.

Also:
3. Add a fixture row with a **different `workspace_id`** so the
   `.eq("workspace_id", workspaceId)` filter is exercised. Currently all fixture
   rows share the same workspace id, so deleting that filter passes everything.
4. Assert that the returned member objects include `id` (AS-030 names it
   explicitly). The current tests use `toMatchObject`, which only checks
   `userId`/`name`/`avatarUrl`.
5. Add an error-path test that drives the `membersError` scenario. `membersError`
   is declared and reset in `beforeEach` but never set by any test; the `throw`
   branch in members.ts is dead scaffolding.

**Mutation bar:** the mutation `r.status !== "removed"` → `r.status === "active"`
is what we want to keep; the reverse direction `r.status !== "removed"` must now
FAIL at least one test.

## Files

- `tests/unit/switcher-member-source.test.ts` only (no impl changes expected)

## Gate

```bash
npx vitest run tests/unit/switcher-member-source.test.ts
npx tsc --noEmit
# Mutation test (do NOT commit): change filter to r.status !== "removed" → must fail ≥1 test
```
