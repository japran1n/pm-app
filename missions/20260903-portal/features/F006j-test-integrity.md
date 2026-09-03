# F006j: Tests that cannot fail are worse than missing tests

**Milestone:** M1 remediation, round 2
**Estimated worker time:** 1.5 h
**Opened by:** the M1 re-scrutiny

## The defects

1. **`tests/integration/f002-phase-management.test.ts:672` signs in as
   the workspace owner**, which short-circuits at `phases.ts:827` before
   `explicitMemberProjectIds` is ever consulted. Break the
   `project_members` lookup completely and both the deny test (fails
   closed) and the allow test (owner bypass) still pass. Nothing
   exercises a hit. The `project_members` fixture row at `:207-211` is
   dead code.

2. **`tests/unit/portal-phases-query.test.ts` mocks a chain that
   discards its own `.eq()` arguments** — the mock cannot tell whether
   the filter was applied, so the test cannot fail when it is dropped.
   (F006f may already fix this; check before duplicating.)

3. The unit test whose comment claims to be the AS-013 regression guard
   is not — the real guard is
   `f002-phase-management.test.ts:465`, which calls the real
   `getTaskDetail`. Fix the comment so the next person does not delete
   the wrong one.

## Why this is its own feature

Three separate tests in this mission asserted something they could not
observe. Each was written by a different worker, each passed, and each
gave a false green that a later review had to catch by reading code. The
pattern is worth removing deliberately rather than one at a time.

## Scope

1. Rewrite the phase-visibility tests to sign in as a **non-owner
   member** who is not in `project_members` of the private project —
   the actual attacker shape. Prove they fail against the pre-F006d
   code by reverting the check locally, watching them fail, and
   restoring it. Say in the handoff that you did.
2. Fix the mock that discards `.eq()` arguments so it records and
   asserts them.
3. Correct the misleading comment.
4. Add one lint-level or test-level guard that makes the "mock discards
   its filters" shape harder to write again — a shared query-mock helper
   that records calls, used by the portal query tests. Keep it small; a
   helper nobody adopts is not a fix.

## Definition of done

- **Primary success test:** each rewritten test fails against the
  unfixed code and passes against the current code, demonstrated.
- **Failure test:** n/a — this feature is failure tests.
- **Manual verification:** no test in `tests/` that asserts a filter
  uses a mock incapable of observing it, for the portal query files.
- **Side-effect verification:** suite runtime for those files does not
  meaningfully increase.
