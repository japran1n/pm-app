# Handoff: F006j — Tests that cannot fail are worse than missing tests

## Status
COMPLETE

## Assertions covered
None directly assigned (same as F006d, F006h, and F006i before it: this
is a remediation feature opened by the M1 re-scrutiny, not one of the
mission's originally-planned/clarified features — no
`clarifications/F006j-clarification.md` exists, and F006j does not
appear in `plan.md` or `validation-contract.md`, verified by grep — no
match for "F006j" in either file). The feature protects the test coverage
that backs AS-013 (task→phase assignment) and its own private-project
authorisation gate (the fix from F006d), which the M1-scrutiny-2.md
report's NM-6a finding showed was previously unfalsifiable. See
"Decisions made" below for how each of the four scope items was verified.

## Files changed
tests/unit/helpers/query-filter-mock.ts (new)
tests/unit/portal-phases-query.test.ts
tests/unit/portal-overview-queries.test.ts
tests/integration/f002-phase-management.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint tests/unit/portal-phases-query.test.ts tests/unit/portal-overview-queries.test.ts tests/unit/helpers/query-filter-mock.ts tests/integration/f002-phase-management.test.ts` (0 errors)
`npx vitest run tests/unit/portal-phases-query.test.ts tests/unit/portal-overview-queries.test.ts` (0, 26/26 passed — after adopting the shared helper)
`npx vitest run tests/integration/f002-phase-management.test.ts` (0, 29/29 passed — against current/fixed code, live Supabase, credentials from `.env`)
`npx vitest run tests/integration/f002-phase-management.test.ts -t "F006d"` (temporarily broke `lib/actions/phases.ts`'s `project_members` lookup — see below — 1 failed, 2 passed: the rewritten allow test now fails, the deny test still passes vacuously, exactly as M1-scrutiny-2's NM-6a predicted)
`npx vitest run tests/integration/f002-phase-management.test.ts -t "F006d"` (temporarily reverted the entire private-project gate — see below — 1 failed, 2 passed: the deny test now fails, the rewritten allow test still passes trivially)
`npx vitest run tests/integration/f002-phase-management.test.ts --reporter=verbose` (0, 29/29 passed — after restoring `lib/actions/phases.ts` to its committed state, confirmed via `git diff lib/actions/phases.ts` showing no diff before and after both experiments)
Full vitest suite NOT run, per instruction (another worker is active in this repo).

## Decisions made

**Item 1 — the two live experiments that prove the rewritten tests can fail.**
Read `tests/integration/f002-phase-management.test.ts` fully first. Found
the deny test (`"F006d: bulkSetTaskPhase rejects a task in a private
project the caller isn't an explicit member of"`, then at line 629) ALREADY
signs in as `memberEmail` — a real workspace `member` with no
`project_members` row for the private project — for the actual
`bulkSetTaskPhase` call (line 653, confirmed via `grep -n "signInAs"`
against the file before any edit). That test is not vacuous; it already
exercises the real attacker shape. The one genuinely broken test, matching
M1-scrutiny-2.md's NM-6a citation of line `:672` exactly, was
`"F006d: bulkSetTaskPhase still succeeds for a private-project task the
caller IS an explicit member of"` — it signed in as `ownerEmail` for BOTH
setup and the call under test, and `isProjectVisibleToCaller`
(`lib/actions/project-visibility.ts:26`) plus the identical inline check
in `lib/actions/phases.ts:826-828` both short-circuit on
`role === "owner"` before `explicitMemberProjectIds` is ever consulted —
so the `beforeAll` fixture's `project_members` row for `ownerUserId`
(`:218-222` pre-edit) was dead: no assertion in the file depended on it.

Fix: added a fifth fixture user, `explicitMemberEmail` (workspace role
`"member"`, so the role short-circuit does NOT apply), gave THAT user the
explicit `project_members` row on `privateProjectId` (replacing the dead
owner row, not adding alongside it — an owner's own project_members row
would still be dead code with the new user added), and rewrote the "still
succeeds" test to sign in as `explicitMemberEmail` for the
`bulkSetTaskPhase` call (owner still creates the phase/task in setup,
since that's unrelated to what's under test). Renamed the test to
`"F006d/F006j: bulkSetTaskPhase still succeeds for a private-project task
a non-owner caller IS an explicit member of"`.

Then proved both tests can fail, with the suite run and restored between
each experiment (`git diff lib/actions/phases.ts` showed no diff
before/after both, confirming a clean restore):

1. **Broke the `project_members` lookup** (`lib/actions/phases.ts:804-808`,
   changed `.eq("user_id", user.id)` to `.eq("user_id",
   "00000000-...")` — the exact "wrong user id" break M1-scrutiny-2's
   NM-6a names). Ran `-t "F006d"`: the rewritten allow test FAILED
   (`AssertionError: expected [ { …(2) } ] to have a length of +0 but got
   1` at the `failedIds` assertion — the explicit member was wrongly
   rejected because the lookup always returns empty). The deny test still
   PASSED (fails closed regardless, as the report predicted — it cannot
   detect this specific class of break, only the allow test can). The RPC
   viewer-rejection test also passed (unaffected, different code path).
   Restored the line; `git diff` confirmed identical to HEAD.
2. **Reverted the entire private-project gate** (added `false &&` in
   front of the `context.visibility === "private" && ...` condition,
   simulating pre-F006d). Ran `-t "F006d"`: the DENY test FAILED
   (`failedIds` was empty — the attacker's write went through with no
   gate at all), and the rewritten allow test still PASSED (trivially —
   with no gate, everyone succeeds, so this experiment doesn't
   discriminate for the allow test, which is expected: it's not designed
   to catch "the gate doesn't exist," only "the gate's lookup is wrong").
   Restored the line; `git diff` confirmed identical to HEAD.

Together these two experiments show each rewritten/verified test detects
a distinct regression: the deny test the presence of the gate at all, the
rewritten allow test the correctness of `explicitMemberProjectIds`'s own
lookup — closing "nothing exercises a hit" from the M1 report.

**Item 2 — the mock that discarded `.eq()` arguments.**
Checked F006f's handoff and diff first, per instructions. F006f
(commit reviewed as part of M1-scrutiny-2, `git log` confirms) already
fixed both `tests/unit/portal-phases-query.test.ts` and
`tests/unit/portal-overview-queries.test.ts` to apply each `.eq()`/
`.in()`/`.is()` call's column/value against the fixture row set instead
of discarding it — verified by reading both files' current mock
implementations before touching them; no duplicate fix applied. Nothing
left to do here beyond item 4's dedup.

**Item 3 — the misleading AS-013 regression-guard comment.**
Grepped for "AS-013" and "regression" across `tests/unit/` and
`tests/integration/`. Found `tests/unit/f002-task-detail-sheet-phase-
optimistic.test.tsx`'s header comment (lines 24-29) and its inline
comment (lines 261-267) ALREADY correctly disclaim: "The actual 'does a
real assignment survive a real reload' claim is proven by
tests/integration/f002-phase-management.test.ts's
test_AS_013_getTaskDetail_returns_the_phase_a_reload_would_show, which
calls the REAL getTaskDetail." `git log --oneline -- tests/unit/f002-
task-detail-sheet-phase-optimistic.test.tsx` shows this attribution was
added in `7f14441` (F006c), which M1-scrutiny-2.md's own header lists as
one of the four commits it reviewed. I could not find any other file in
the repo whose comment self-claims the AS-013 phase-persistence
regression-guard role (grep for "AS-013" across `tests/unit/` turns up
only this file and `tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx`,
whose "AS-013" is a DIFFERENT mission's assertion numbering for an
unrelated checkbox feature, confirmed by reading its content — not the
phase-persistence one this item is about). Concluded: item 3 was already
resolved by F006c before this feature started; no change needed. Left as
a no-op rather than inventing a rewrite of a comment that already says
the correct thing, per the "no fabricated changes" instinct this
feature's own theme is about.

**Item 4 — the shared query-mock helper, adopted, not just added.**
Created `tests/unit/helpers/query-filter-mock.ts` (small: `eqFilter`,
`inFilter`, `applyFilters`, and the `Row` type — three tiny functions, no
generic Supabase-client mock, since each test's own chain SHAPE — which
methods exist, in what order — is itself part of what that test proves
matches the real query). Location and import path
(`@/tests/unit/helpers/<name>`) follow the existing precedent at
`tests/unit/helpers/faithful-realtime-client.ts`, imported by
`tests/unit/realtime-strict-mode-remount.test.ts:19` as
`@/tests/unit/helpers/faithful-realtime-client` — grep-verified, not
assumed. Removed the duplicated `eqFilter`/`inFilter`/`applyFilters`
definitions from both `portal-phases-query.test.ts` and
`portal-overview-queries.test.ts` and imported from the shared helper
instead — both files' full test suites still pass (26/26) after the
swap, confirming the extraction didn't change behaviour. Grepped
`tests/unit/*.ts` for any other portal query test reimplementing the same
three functions after the extraction — none found.

## Out-of-scope work needed
- M1-scrutiny-2.md's NM-6a also flags that the deny test at (then) `:629`
  "asserts only `failedIds[0]?.id`, never `.reason`," and that there is
  no mixed-batch (partial success) test for `bulkSetTaskPhase` anywhere
  in the file — both are also named again in the report's own FU-19(a).
  Neither is in this feature's four numbered scope items (rewrite actor,
  fix mock, fix comment, add shared helper), so I left both alone rather
  than silently expanding scope. A future worker adding a `.reason`
  assertion to the deny test and a genuine mixed-batch case (one allowed
  task + one private-project-blocked task in the same call, asserting
  both `succeededIds` and `failedIds` with a DB read-back for each) would
  close FU-19(a) completely.
- FU-19(b) (a direct `clientSession.from("client_requests").select()` in
  `f003-portal-shell.test.ts` to prove the SELECT-policy half of
  `20260913010000` at the database) is untouched — not named in this
  feature's scope, which only lists the three phase/mock/comment defects.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Removed the pre-existing `beforeAll` `project_members`
row for `ownerUserId` on `privateProjectId` rather than keeping it
alongside the new `explicitMemberEmail` row. Reasoning: `isProjectVisibleToCaller`
(`lib/actions/project-visibility.ts:26`) and `bulkSetTaskPhase`'s own
inline check (`lib/actions/phases.ts:826-828`) both bypass the
private-project gate on `role === "owner"` alone, so an owner's
`project_members` row is dead fixture data regardless of which other
tests exist — keeping it would have left exactly the same "dead fixture
row" defect the M1 report named, just alongside a live one instead of
being the only one. Grepped the rest of the file for any other use of
`ownerUserId` combined with `privateProjectId`-scoped `project_members`
reads before removing it; found none.

AUTONOMOUS_DECISION: Did not rewrite the deny test's actor. Verified via
`grep -n "signInAs"` (shown in "Decisions made") that it already signs in
as a non-owner, non-explicit-member `member` for the actual
`bulkSetTaskPhase` call, matching "the actual attacker shape" the task
description asked for. Rewriting an already-correct test risked
introducing the exact kind of unverified churn this feature exists to
prevent; instead I ran the "revert F006d's check" experiment against it
specifically to demonstrate, rather than assume, that it already works.

## Notes for the next worker
- The two temporary breakages used to prove the rewritten test can fail
  (`lib/actions/phases.ts`'s `project_members` `.eq("user_id", ...)`
  filter, and the private-project `if` condition) were both restored
  immediately after their respective test runs; `git diff
  lib/actions/phases.ts` was empty before this feature started and is
  empty now — the file is untouched in the final commit.
- `tests/unit/helpers/query-filter-mock.ts` is the place to add any
  further row-filter primitives future portal query unit tests need
  (e.g. a `neqFilter` or `isNullFilter` if a test needs to prove a
  `.is("deleted_at", null)`-style call is honoured) — keep it small and
  table-agnostic; each test file's own `vi.mock(...)` chain shape stays
  local to that file since the chain shape is itself part of the
  behaviour under test.
- No MCP tools were used — this feature is pure test-code and one
  temporary, fully-reverted application-code experiment; no live schema
  or remote config was inspected or changed.
