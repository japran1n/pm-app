# F025: Test that a direct write to another member's block is refused server-side

**Milestone:** M5 — Read-only
**Estimated worker time:** 15 minutes
**Depends on:** F020 (ownership predicate), F011/RLS migration 20261128010001

## Assertion IDs covered
- AS-050: A write aimed at another member's block is rejected by the server even when issued directly, bypassing the interface.

## Draft scope
- Test-only feature. No implementation changes.
- Add `tests/integration/planner-block-write-rls.test.ts` proving RLS refuses
  a direct UPDATE/DELETE from one workspace member to a calendar block owned
  by another member.

## Clarified implementation

**Pattern:** Follow the exact structure of
`tests/integration/planner-block-rls.test.ts` (F011's RLS suite):
`loadDotEnv()` helper reading `.env`, admin client via
`SUPABASE_SECRET_KEY`, session clients via
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`describe.skipIf(!haveAdminCreds)` gating, `beforeAll` wrapped in try/catch
with a `skipDueToNetwork` flag skipping tests gracefully when the network
is unreachable, and cleanup of created rows/users in `afterAll`.

**Data shape:** Two members (memberA, memberB) created via
`adminClient.auth.admin.createUser` and inserted into the same
workspace's `workspace_members` as `role: "member", status: "active"`.
memberA creates one `calendar_blocks` row via their own authenticated
session (RLS-enforced insert). memberB then attempts to UPDATE and
DELETE that row via their own session.

**State location:** No repo application state touched — this is a
database-level integration test asserting behaviour of RLS policies
already shipped in `supabase/migrations/20261128010001_...sql` and the
original `20261107010000_calendar_blocks.sql` write policies
(`using (user_id = auth.uid())`).

**API contract:** UPDATE/DELETE against a foreign-owned row must return
`error: null` and `data: []` (this repo's established "no matching row
under RLS => empty result set, not an error" convention, matching the
sibling assertions in `planner-block-rls.test.ts`). An admin-bypass
follow-up read after each attempt confirms the row still exists /
retains its original value, proving RLS — not a missing id — blocked
the write.

**Failure handling:** Network/credential unavailability skips the whole
suite via `describe.skipIf` and the `skipDueToNetwork` `beforeEach`
guard; CI throws early if creds are required but missing (mirrors
F011's CI guard).

**Empty state:** N/A (test-only feature).

**Validation:** N/A.

**Performance budget:** N/A (test-only, network-gated).

**Access control:** N/A — this test *is* the access-control verification.

## Files
- `tests/integration/planner-block-write-rls.test.ts` (new)

## Definition of done
- `npx tsc --noEmit` passes with no new errors.
- `npx vitest run tests/integration/planner-block-write-rls.test.ts` passes
  (or skips cleanly with 0 failures when Supabase is unreachable).
- Two tests: memberB cannot UPDATE memberA's block; memberB cannot DELETE
  memberA's block. Both assert `error: null`, `data: []`, and confirm via
  admin-bypass read that the row is untouched/still present.
- Test names reference `AS_050`.

## Notes for clarification
The UI gating in F021-F024 is convenience; this is the actual boundary.
This feature only adds a new sibling test file — it does not modify
`planner-block-rls.test.ts` or any migration.
